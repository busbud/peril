import * as child_process from "child_process"

import { jsonDatabase } from "../db/json"
import { DATABASE_JSON_FILE } from "../globals"

const log = console.log

const go = async () => {
  // Download settings
  const db = jsonDatabase(DATABASE_JSON_FILE)
  await db.setup()

  const installation = await db.getInstallation(0)
  if (!installation) {
    return
  }
  // Look for plugins
  if (installation.settings.modules && installation.settings.modules.length !== 0) {
    const modules = installation.settings.modules
    log("Installing: " + modules.join(", "))

    const yarn = child_process.spawn("yarn", ["add", ...modules, "--ignore-scripts"], {
      env: { ...process.env, NO_RECURSE: "YES" },
    })

    yarn.stdout.on("data", data => log(`-> : ${data}`))
    yarn.stderr.on("data", data => log(`! -> : ${data}`))

    yarn.on("close", code => {
      log(`child process exited with code ${code}`)
      process.exit(code)
    })
  } else {
    log("Not adding any plugins")
    process.exit(0)
  }
}

go()
