import * as debug from "debug"
import * as JSON5 from "json5"

import { connect, Document, model, Schema } from "mongoose"

import _ = require("lodash")
import { getTemporaryAccessTokenForInstallation } from "../api/github"
import { dangerRepresentationForPath } from "../danger/danger_run"
import { getGitHubFileContentsFromLocation } from "../github/lib/github_helpers"
import { MONGODB_URI } from "../globals"
import { sendSlackMessageToInstallation } from "../infrastructure/installationSlackMessaging"
import { GitHubInstallation } from "./index"

const d = debug("peril:mongo")

/**
 * Basically the same thing as a PerilInstallationSettings but coming from the database
 * which might mean that we add extra db-specific metadata
 */
export interface MongoGithubInstallationModel extends Document, GitHubInstallation {
  /** If this is set to be in the future, any webhook for this installation will get saved in the db */
  recordWebhooksUntilTime: Date
  /** The time when a user requested recording webhooks */
  startedRecordingWebhooksTime: Date
  /** A string Peril can use to pass critical message */
  installationSlackUpdateWebhookURL: string
  /** An image representation of the installation */
  avatarURL: string
  /** The name to trigger the lambda with */
  lambdaName: string
}

/** The model for an installation in the DB */
const Installation = model<MongoGithubInstallationModel>(
  "GithubInstallation",
  new Schema({
    // Comes from the JSON config
    repos: Schema.Types.Mixed,
    rules: Schema.Types.Mixed,
    settings: Schema.Types.Mixed,
    tasks: Schema.Types.Mixed,
    scheduler: Schema.Types.Mixed,

    // Needed by Peril
    iID: Number,
    login: String,
    avatarURL: String,
    perilSettingsJSONURL: String,
    startedRecordingWebhooksTime: Date,
    recordWebhooksUntilTime: Date,
    installationSlackUpdateWebhookURL: String,
    envVars: Schema.Types.Mixed,
    lambdaName: String,
  })
)

/* 
 * Basically, Mongo does not allow you to have a key with a '.' in it. This
 * isn't great for us, because 'x.y' is real common, so, we amend the keys in
 * the JSON on load/save to ensure it can be saved.
 */
const userInput = ["repos", "rules", "settings", "tasks", "scheduler", "envVars"]

export const prepareToSave = (installation: Partial<GitHubInstallation>) => {
  const amendedInstallation: any = installation
  userInput.forEach(i => {
    if (amendedInstallation[i]) {
      amendedInstallation[i] = removeDots(amendedInstallation[i])
    }
  })
  return installation
}

export const convertDBRepresentationToModel = (installation: GitHubInstallation) => {
  const amendedInstallation: any = installation
  userInput.forEach(i => {
    if (amendedInstallation[i]) {
      amendedInstallation[i] = bringBackDots(amendedInstallation[i])
    } else {
      // Handles the potential nullability of the userInputs above
      amendedInstallation[i] = {}
    }
  })
  return installation
}

// We can't store keys which have a dot/dollar in them, and basically all settings JSON has dots.
// See https://docs.mongodb.com/manual/reference/limits/#Restrictions-on-Field-Names
const removeDots = (obj: object) => transformKeys(obj, ".", "___", "$", "^^^")
const bringBackDots = (obj: object) => transformKeys(obj, "___", ".", "^^^", "$")

const transformKeys = (obj: any, before1: string, after1: string, before2: string, after2: string) =>
  Object.keys(obj).reduce(
    (o, prop) => {
      const value = obj[prop]
      const newProp = prop.replace(before1, after1).replace(before2, after2)
      o[newProp] = value
      return o
    },
    {} as any
  )

export const mongoDatabase = {
  setup: async () => {
    await connect(MONGODB_URI)
  },

  /** Saves an Integration */
  saveInstallation: async (installation: Partial<MongoGithubInstallationModel>) => {
    d(`Saving installation with id: ${installation.iID}`)

    const sanitizedInstallation = prepareToSave(installation)
    const dbInstallation = await Installation.findOne({ iID: installation.iID })

    const newInstallation = // Update it, or make it
      (dbInstallation && Object.assign(dbInstallation, sanitizedInstallation)) ||
      new Installation(sanitizedInstallation)

    await newInstallation.save()
    return newInstallation
  },

  /** Gets an installation */
  getInstallation: async (installationID: number): Promise<GitHubInstallation | null> => {
    const dbInstallation = await Installation.findOne({ iID: installationID })
    return (dbInstallation && convertDBRepresentationToModel(dbInstallation)) || null
  },

  /** Gets an installation via it's ID in the db, used in Relay */
  getInstallationByDBID: async (id: string): Promise<GitHubInstallation | null> => {
    const dbInstallation = await Installation.findById(id)
    return (dbInstallation && convertDBRepresentationToModel(dbInstallation)) || null
  },

  /** Gets a set of Integrations */
  getInstallations: async (installationID: number[]): Promise<GitHubInstallation[]> => {
    const dbInstallations = await Installation.where("iID").in(installationID)
    return dbInstallations.map(convertDBRepresentationToModel)
  },

  /** Search through the installations for ones that match a particular scheduler key */
  getSchedulableInstallationsWithKey: async (key: string): Promise<GitHubInstallation[]> => {
    const query: any = {}
    query[`scheduler.${key}`] = { $exists: true }
    const dbInstallations = await Installation.find(query)
    return dbInstallations.map(convertDBRepresentationToModel)
  },

  /** Search through the installations for ones that match a particular scheduler key */
  getLambdaBasedInstallations: async (): Promise<GitHubInstallation[]> => {
    const query: any = {}
    query[`lambdaName`] = { $exists: true }
    const dbInstallations = await Installation.find(query)
    return dbInstallations.map(convertDBRepresentationToModel)
  },

  /** Requests an update for an installation based on grabbing the JSON from the Peril Settings config file */
  updateInstallation: async (installationID: number) => {
    const dbInstallation = await Installation.findOne({ iID: installationID })
    if (!dbInstallation) {
      d(`Could not get a db reference for installation ${installationID} when updating`)
      throw new Error("Could not find installation")
    }

    if (!dbInstallation.perilSettingsJSONURL) {
      d(`Could not get installation ${installationID} did not have a perilSettingsJSONURL when updating`)
      throw new Error("Installation did not have a settings JSON url.")
    }

    const pathRep = dangerRepresentationForPath(dbInstallation.perilSettingsJSONURL)
    if (!pathRep.repoSlug || !pathRep.dangerfilePath) {
      d(`DangerfilePath for ${installationID} did not have a repoSlug/dangerfilePath when updating`)
      throw new Error(
        "Settings reference string did not contain a repo. Please use a string like 'org/repo@path/to/settings.json'."
      )
    }

    const token = await getTemporaryAccessTokenForInstallation(dbInstallation.iID)
    const file = await getGitHubFileContentsFromLocation(token, pathRep, pathRep.repoSlug!)
    if (file === "") {
      d(`Settings for ${installationID} at ${dbInstallation.perilSettingsJSONURL} were empty`)
      throw new Error("The settings file was empty.")
    }

    // Only allow the JSON to overwrite user editable settings in mongo
    let json = {} as any
    try {
      json = JSON5.parse(file)
    } catch (error) {
      d(`Settings for ${installationID} were not valid json`)
      sendSlackMessageToInstallation(
        `Settings at \`${dbInstallation.perilSettingsJSONURL}\` did not parse as JSON.`,
        dbInstallation
      )

      throw error
    }

    const parsedSettings: Partial<GitHubInstallation> = _.pick(json, userInput)
    const sanitizedSettings = prepareToSave(parsedSettings)
    return (await Installation.updateOne({ iID: installationID }, sanitizedSettings)) as Promise<
      MongoGithubInstallationModel
    >
  },

  /** Deletes an Integration */
  deleteInstallation: async (installationID: number) => {
    const dbInstallation = await Installation.findOne({ iID: installationID })
    if (dbInstallation) {
      await dbInstallation.remove()
    }
  },
}

export type MongoDB = typeof mongoDatabase
