import { jsonDatabase } from "./json"
import { mongoDatabase } from "./mongo"

import { DatabaseAdaptor } from "."
import { RuntimeEnvironment } from "./runtimeEnv"

const isJest = typeof jest !== "undefined"

const hasJSONDef = !!process.env.DATABASE_JSON_FILE
const hasPerilAPIURL = !!process.env.PUBLIC_API_ROOT_URL

const hasLambdaEnv = !!process.env._HANDLER

/** There are three runtime environments for Peril, this says which one it is */
export const runtimeEnvironment = hasJSONDef
  ? RuntimeEnvironment.Standalone
  : hasPerilAPIURL
    ? RuntimeEnvironment.Peril
    : hasLambdaEnv
      ? RuntimeEnvironment.Runner
      : RuntimeEnvironment.Unknown

const getDatabaseForEnv = (env: any): DatabaseAdaptor | null => {
  if (env.DATABASE_JSON_FILE || isJest) {
    const json = jsonDatabase(env.DATABASE_JSON_FILE)
    json.setup()
    return json
  }

  if (env.MONGODB_URI) {
    if (!isJest) {
      mongoDatabase.setup()
    }
    return mongoDatabase
  }

  return null
}

let db: DatabaseAdaptor | null = null
/** Gets the Current DB for this runtime environment */
export const getDB = () => {
  if (!db) {
    db = getDatabaseForEnv(process.env)
  }

  if (!db) {
    throw new Error("No default DB was set up")
  }

  return db
}
