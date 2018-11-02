// spotty - Extract scripts from a Spotfire DXP file
// Usage:
//    node spotty.js source.dxp ./output
// Result:
//    JS will be placed in ./output/js and Python in ./output/python

const unzip = require('unzip-stream')
const parser = require('fast-xml-parser')
const fs = require('fs')

const debug = true
const verbose = false
const xmlParsingOpts = {
  ignoreAttributes: false,
  parseAttributeValue: true
}

var inputFile = ''
var outputDir = ''

inputFile = process.argv[2]
outputDir = process.argv[3]

getScripts().then(writeScripts).catch((err) => {
  console.log('Error: ' + err)
})

function getScripts () {
  return unzipResources().then(parseResources).then(unzipScripts).then(parseScripts)
}

function unzipResources () {
  return extractFileFromZip(inputFile, 'EmbeddedResources.xml')
}

function unzipScripts (resourcePath) {
  return extractFileFromZip(inputFile, resourcePath)
}

function parseResources (xmlData) {
  return new Promise((resolve, reject) => {
    if (debug) console.log('Parsing EmbeddedResources.xml to find EmbeddedScripts.xml')
    if (parser.validate(xmlData) === false) {
      reject(new Error('Invalid or nonexistent XML in EmbeddedResources.xml'))
    }

    let xmlObj = parser.getTraversalObj(xmlData, xmlParsingOpts)

    if (
      xmlObj.child.EmbeddedResources.count === 0 ||
      xmlObj.child.EmbeddedResources[0].child.count === 0
    ) reject(new Error('No embedded resources in DXP file.'))

    let foundScripts = false
    for (let resource of xmlObj.child.EmbeddedResources[0].child.EmbeddedResource) {
      if (verbose) console.log(resource.attrsMap)

      let resourceName = resource.attrsMap['@_Name']
      let filePath = resource.attrsMap['@_ArchiveElementPath']

      if (resourceName === 'EmbeddedScripts.xml') {
        if (debug) console.log('Found EmbeddedScripts.xml in file ' + filePath)
        foundScripts = true
        resolve(filePath)
      }
    }
    if (foundScripts === false) reject(new Error('No scripts found embedded in DXP file.'))
  })
}

function parseScripts (xmlData) {
  return new Promise((resolve, reject) => {
    if (parser.validate(xmlData) === false) {
      reject(new Error('Invalid or nonexistent XML in EmbeddedScripts.xml'))
    }

    let xmlObj = parser.getTraversalObj(xmlData, xmlParsingOpts)
    if (
      xmlObj.child.EmbeddedScripts.count === 0 ||
      xmlObj.child.EmbeddedScripts[0].child.EmbeddedScript.count === 0
    ) reject(new Error('No embedded resources in DXP file.'))

    let scripts = []
    for (let script of xmlObj.child.EmbeddedScripts[0].child.EmbeddedScript) {
      let scriptDefinition = script.child.ScriptDefinition[0]
      let attrs = scriptDefinition.attrsMap
      if (verbose) console.log(attrs)

      let parsedCode = scriptDefinition.child.ScriptCode[0].val
        .replace(/_x09/g, '\t')
        .replace(/&amp;/g, '&')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')

      scripts.push({
        name: attrs['@_Name'],
        language_name: attrs['@_LanguageName'],
        language_version: attrs['@_LanguageVersion'],
        wrap_script: attrs['@_WrapScript'],
        code: parsedCode
      })
    }
    if (scripts.length > 0) {
      resolve(scripts)
    } else {
      reject(new Error('No scripts found embedded in DXP file.'))
    }
  })
}

function writeScripts (scripts) {
  return new Promise((resolve, reject) => {
    ensureDirectory(outputDir)
    for (let script of scripts) {
      let subdir; let extension = ''
      if (script.language_name === 'JavaScript') {
        subdir = '/js'
        extension = 'js'
      } else if (script.language_name === 'IronPython') {
        subdir = '/python'
        extension = 'py'
      } else {
        subdir = script.language_name
        extension = script.language_name
      }
      ensureDirectory(outputDir + subdir)
      let outputPath = outputDir + subdir + '/' + script.name + '.' + extension
      fs.writeFile(outputPath, script.code, (err) => {
        if (err) reject(err)
        if (verbose) console.log('Wrote file: ' + outputPath)
      })
    }
    console.log(`Wrote ${scripts.length} script files to ${outputDir}`)
  })
}

function extractFileFromZip (zipFile, filePath) {
  return new Promise((resolve, reject) => {
    if (debug) console.log(`Searching ${zipFile} for ${filePath}`)

    var fileFound = false
    fs.createReadStream(zipFile)
      .pipe(unzip.Parse())
      .on('entry', (entry) => {
        if ((entry.path === filePath) && !fileFound) {
          if (debug) console.log('Found file: ' + entry.path)
          fileFound = true

          let data = ''
          entry.on('data', (chunk) => { data = data + chunk })
          entry.on('end', () => {
            if (verbose) console.log(data)
            resolve(data)
            entry.emit('close')
          })
        } else {
          entry.autodrain()
        }
      })
      .on('close', () => {
        if (!fileFound) { reject(new Error('Could not find file ' + filePath + ' in file ' + zipFile)) }
      })
      .on('error', (err) => {
        reject(err)
      })
  })
}

function ensureDirectory (path) {
  if (!fs.existsSync(path)) fs.mkdirSync(path)
}
