/* eslint dot-notation: "off" */

import * as WS from 'ws' // eslint-disable-line
import { PluginClient } from '@remixproject/plugin'
import { existsSync, readFileSync } from 'fs'
import { OutputStandard } from '../types' // eslint-disable-line
const { spawn, execSync } = require('child_process')

export class SlitherClient extends PluginClient {
  methods: Array<string>
  websocket: WS
  currentSharedFolder: string

  constructor (private readOnly = false) {
    super()
    this.methods = ['analyse']
  }

  setWebSocket (websocket: WS): void {
    this.websocket = websocket
  }

  sharedFolder (currentSharedFolder: string): void {
    this.currentSharedFolder = currentSharedFolder
  }

  transform (detectors: Record<string, any>[]): OutputStandard[] {
    const standardReport: OutputStandard[] = []
    for (const e of detectors) {
      const obj = {} as OutputStandard
      obj.description = e.description
      obj.title = e.check
      obj.confidence = e.confidence
      obj.severity = e.impact
      obj.sourceMap = e.elements.map((element) => {
        delete element.source_mapping.filename_used
        delete element.source_mapping.filename_absolute
        return element
      })
      standardReport.push(obj)
    }
    return standardReport
  }

  analyse (filePath: string, compilerConfig: Record<string, any>) {
    return new Promise((resolve, reject) => {
      if (this.readOnly) {
        const errMsg: string = '[Slither Analysis]: Cannot analyse in read-only mode'
        return reject(new Error(errMsg))
      }
      const options = { cwd: this.currentSharedFolder, shell: true }
      const { currentVersion, optimize, evmVersion } = compilerConfig
      if (currentVersion && currentVersion.includes('+commit')) {
        // Get compiler version with commit id e.g: 0.8.2+commit.661d110
        const versionString: string = currentVersion.substring(0, currentVersion.indexOf('+commit') + 16)
        console.log('\x1b[32m%s\x1b[0m', `[Slither Analysis]: Compiler version is ${versionString}`)
        // Check solc current installed version
        const solcOutput: Buffer = execSync('solc --version', options)
        if (!solcOutput.toString().includes(versionString)) {
          console.log('\x1b[32m%s\x1b[0m', '[Slither Analysis]: Compiler version is different from installed solc version')
          // Get compiler version without commit id e.g: 0.8.2
          const version: string = versionString.substring(0, versionString.indexOf('+commit'))
          // List solc versions installed using solc-select
          const solcSelectInstalledVersions: Buffer = execSync('solc-select versions', options)
          // Check if required version is already installed
          if (!solcSelectInstalledVersions.toString().includes(version)) {
            console.log('\x1b[32m%s\x1b[0m', `[Slither Analysis]: Installing ${version} using solc-select`)
            // Install required version
            execSync(`solc-select install ${version}`, options)
          }
          console.log('\x1b[32m%s\x1b[0m', `[Slither Analysis]: Setting ${version} as current solc version using solc-select`)
          // Set solc current version as required version
          execSync(`solc-select use ${version}`, options)
        } else console.log('\x1b[32m%s\x1b[0m', '[Slither Analysis]: Compiler version is same as installed solc version')
      }
      const outputFile: string = 'remix-slitherReport_' + Date.now() + '.json'
      const optimizeOption: string = optimize ? '--optimize ' : ''
      const evmOption: string = evmVersion ? `--evm-version ${evmVersion}` : ''
      const solcArgs: string = optimizeOption || evmOption ? `--solc-args '${optimizeOption}${evmOption}'` : ''
      const cmd: string = `slither ${filePath} ${solcArgs} --json ${outputFile}`
      console.log('\x1b[32m%s\x1b[0m', '[Slither Analysis]: Running Slither...')
      const child = spawn(cmd, options)
      const response = {}
      child.on('close', () => {
        const outputFileAbsPath: string = `${this.currentSharedFolder}/${outputFile}`
        // Check if slither report file exists
        if (existsSync(outputFileAbsPath)) {
          let report = readFileSync(outputFileAbsPath, 'utf8')
          report = JSON.parse(report)
          if (report['success']) {
            response['status'] = true
            if (!report['results'] || !report['results'].detectors || !report['results'].detectors.length) {
              response['count'] = 0
            } else {
              const { detectors } = report['results']
              response['count'] = detectors.length
              response['data'] = this.transform(detectors)
            }
            console.log('\x1b[32m%s\x1b[0m', `[Slither Analysis]: Analysis Completed!! ${response['count']} warnings found.`)
            resolve(response)
          } else {
            console.log('\x1b[31m%s\x1b[0m', '[Slither Analysis]: Error in running Slither Analysis')
            console.log(report['error'])
            reject(new Error('Error in running Slither Analysis. See remixd console for details.'))
          }
        } else reject(new Error('Error in generating Slither Analysis Report. See remixd console for details.'))
      })
    })
  }
}
