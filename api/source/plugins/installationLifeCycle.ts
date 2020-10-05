import * as express from "express"
import { createInstallation } from "../github/events/create_installation"
import { deleteInstallation } from "../github/events/deleteInstallation"
import { RootObject as InstallationCreated } from "../github/events/types/installation.types"
import logger from "../logger"

export const installationLifeCycle = (event: string, req: express.Request, res: express.Response, ___: any) => {
  if (event === "installation") {
    const request = req.body as InstallationCreated
    const action = request.action
    const installation = request.installation

    // Create a db entry for any new installation
    if (action === "created") {
      logger.info("")
      logger.info(`## Creating new installation for ${request.installation.account.login}`)
      createInstallation(installation, req, res)
    }

    // Delete any integrations that have uninstalled Peril :wave:
    if (action === "deleted") {
      logger.info("")
      logger.info(`## Deleting installation ${installation.id}`)
      deleteInstallation(installation, req, res)
    }
  }
}
