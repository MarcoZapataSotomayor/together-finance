import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configureProduction } from './check-production-config.mjs'

// Writes only a public local configuration after explicit hostname approval; never deploys.
export async function writeProductionConfig(path, env) {
  const config = configureProduction(
    JSON.parse(await readFile(path, 'utf8')),
    env,
  )
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`)
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await writeProductionConfig(
      new URL('../vercel.json', import.meta.url),
      process.env,
    )
    console.log(
      'Public production rewrite written locally. Review the diff before any deployment.',
    )
  } catch {
    console.error(
      'Production rewrite was not configured. Supply reviewed public origins and explicit approval; values omitted.',
    )
    process.exitCode = 1
  }
}
