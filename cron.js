const yaml = require('yaml')
const fs = require('fs')
const request = require('request')
const path = require('path')
const cheerio = require('cheerio')

const configFile = path.join(__dirname, 'config/config.yaml')
const config = yaml.parse(fs.readFileSync(configFile, 'utf8'))

const store = require('data-store')({ path: path.join(__dirname, 'storage/read.json')})
const parseString = require('xml2js').parseString;

const formats = yaml.parse(fs.readFileSync(path.join(__dirname, 'config/formats.yaml'), 'utf8'))
const journalFile = path.join(__dirname, 'config/journals.yaml')
const journals = yaml.parse(fs.readFileSync(journalFile, 'utf8'))

const AsyncCache = require('async-cache')
const httpCache = new AsyncCache({
  max: 1000,
  maxAge: 1000 * 60 * 10,
  load: function (key, cb) {
      if (config.debug) console.log("Requesting " + key)
      let j = request.jar()
      request.get({url: key, jar: j}, cb)}})

journals.forEach( journal => {

  if (config.init && ! journal.init) return
  if (config.debug && ! journal.debug) return
  ['name', 'feedURL', 'format'].forEach( p => {
    if (typeof(journal[p]) == 'undefined') {
      console.error("Journal missing " + p)
      return }})
  let format = formats[journal.format]
  if (! format) console.error("Format " + journal.format + " not defined")

  httpCache.get( journal.feedURL, (err, result) => {
    let read = []
    let unread = true
    let items = []
    parseString(result.body, function (err, feed) {
      if (err) throw err
      switch (detectFormat(feed)) {
        case 'rdf_ingenta':
          journal.iconURL = journal.iconURL || feed['rdf:RDF'].channel[0].image[0].$['rdf:resource']
          items = feed['rdf:RDF'].item
          break
        case 'rdf':
          journal.iconURL = journal.iconURL || feed['rdf:RDF'].image[0].url
          items = feed['rdf:RDF'].item
          break
        case 'rss2':
          items = feed.rss.channel[0].item
          break
        default:
          console.error("Undefined feed format: " + format.feedFormat)
          return }
      items.filter( item => {
        if (store.has(journal.name)) {
          read = store.get(journal.name)
          if(!config.debug && !config.init) unread = ! read.includes(cleanResult(item[format.rememberBy]))
        } 
        if (unread && !!item.title) {
          return (!['rezensionen',
                    'erratum',
                    'issue information',
                    'editorial board',
                    'corrigendum',
                    'correction'].includes(cleanResult(item.title).toLowerCase()))
        } else return false
      }).forEach( item => { getArticle(item, journal, format) })
    });
  })
})

const getArticle = function(item, journal, format) {
  let article = {
    link: cleanResult(item.link),
    journal: journal.name,
    channels: journal.channels,
    rememberBy: cleanResult(item[format.rememberBy]),
    icon: undefined,
    authors: undefined,
    title: undefined,
    date: undefined,
    doi: undefined,
    firstPage: undefined,
    lastPage: undefined }

  if (journal.iconURL) article.icon = cleanResult(journal.iconURL)
  let siteCache = undefined

  let promises = Object.entries(format.fields).map( async ([field, sources]) => {
    let source = sources[0]
    if (source.key) {
      article[field] = cleanResult()
      return { key : field,
               value : cleanResult(item[source.key], source.extractWith) }}
    else if (source.selector) {
      let x = new Promise( (fulfill, reject) => {
        httpCache.get(article.link, (err, res) => {
          if (err) reject(err)
          let $ = cheerio.load(res.body)
          let raw = $(source.selector).map(function(i, el) {
            return $(this).attr(source.attribute)
          }).get()
          let value = cleanResult(raw, source.extractWith)
          fulfill( { key : field,
                   value : value })})})
      return await x }
    else { throw Error("No valid key or selector for field: " + field) } })
  
  Promise.all(promises)
    .then( results => {
      results.forEach( res => { article[res.key] = res.value })
      processArticle(article)
    })
    .catch(err => console.error(err))}

const cleanResult = function(result, extractWith = undefined) {
  let cleanResult = []
    .concat(result)
    .filter(Boolean)
    .map( x => {
      if (extractWith) {
        let re = new RegExp(extractWith.expression)
        let match = x.match(re)
        x = match ? match[(extractWith.matchNumber||1)] : undefined }
      return x ? cleanString(x) : undefined })
    .filter( x => !!x)
  return (cleanResult.length > 0) ?
    cleanResult.join(' / ') : 
    undefined }

const cleanString = function(string) {
  return string ?
    string
      .trim()
      .replace(/(\n|\r|\t)/gm, " ")
      .replace(/(  )/g, ' ')
      .replace(/<[^>]+>/g, '') : 
    undefined }

const processArticle = function(article) {
  let message = { channels: article.channels,
                  journal: article.journal,
                  icon: article.icon,
                  rememberBy: article.rememberBy }

  let issueString = []
    .concat( article.volume ? "Band " + article.volume : [] )
    .concat( article.issue ? "Ausgabe " + article.issue : [] )
    .concat( article.firstPage && article.lastPage ? 
               "Seiten " + article.firstPage + "–" + article.lastPage :
               [] ).join(", ")

  let publishedLine = [article.date, issueString, article.doi]
    .filter(Boolean)
    .join(" | ")

  message.text = []
    .concat( article.authors ? "*" + article.authors + "*" : [] )
    .concat( article.title ?
              "**["+article.title+"]("+article.link+")**" :
              "**" + article.link + "**" )
    .concat( publishedLine != '' ? publishedLine : [] )
    .join("\r")
  if (config.log) console.log(message)
  if (config.post) announceArticle(message)
  else if (config.save) store.union(message.journal, message.rememberBy)
}

const announceArticle = function(message) {
  if (config.debug) message.channels = ['journals-test']
  message.channels.forEach(channel => {
    request.post({
      headers: { 'content-type' : 'application/json' },
      url: config.webhookURL,
      body: JSON.stringify({
        text     :  message.text,
        channel  :  channel,
        username :  message.journal,
        icon_url :  message.icon,
      })
    }, function(error, response, body){
      if(error) {
        console.error("Could not post: " + error)
        return
      }
      if (config.save) store.union(message.journal, message.rememberBy)
    })
  })
}

const detectFormat = function(feed) {
  if ("rss" in feed) return "rss2"
  if ("rdf:RDF" in feed) return "rdf"
  else {throw Error("Could not detect format")}
}
