import * as express from "express"

import { Installation } from "../events/types/installation.types"

import { getDB } from "../../db/getDB"
import { generateInstallation } from "../../testing/installationFactory"

export async function createInstallation(installationJSON: Installation, _: express.Request, res: express.Response) {
  const installation = generateInstallation({
    iID: installationJSON.id,
    login: installationJSON.account.login,
    avatarURL: installationJSON.account.avatar_url,
  })

  const db = getDB()
  const existingInstallation = await db.getInstallation(installation.iID)
  if (existingInstallation) {
    res.status(204)
    res.send("Did not create new installation, it already existed.")
  } else {
    await db.saveInstallation(installation)
    res.status(200)
    res.send("Creating new installation.")
  }
}
