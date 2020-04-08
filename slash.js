const express = require('express')
const path = require('path')
const yaml = require('yaml')
const fs = require('fs')
const got = require('got')

const journalFile = './config/journals.yaml'
const journals = yaml.parse(fs.readFileSync(journalFile, 'utf8'))

const app = express()
const port = 3002
const token = "nudst5nhfjyx7nk5ti9yrhrumo"
const serverAddress = "https://geocom.uni-frankfurt.de"
const basedir = "/journalbot"
const appName = "Journalbot"


const iconURL = path.join(serverAddress, basedir, "/assets/icon.jpg")

const requestChannel = "journals-requests"
const webhookURL = "https://geocom.uni-frankfurt.de/hooks/qoq1fd678td5bjq85qpjf4a9ye"

var bodyParser = require("body-parser");

const helpMessage = ["| Befehl | Aktion                 |",
                     "|:--|:--|",
                     "| `/journals help` | Diese Hilfe anzeigen |",
                     "| `/journals list` | Abbonierte Zeitschriften für diesen Kanal anzeigen | ",
                     "| `/journals request [Zeitschrift]` | Abbonement anfragen |",
                     "| `/journals cancel [Zeitschrift]` | Abbonnement abbestellen |"]

const buildMessage = function(lines) {
  return { response_type: "ephemeral",
           username: appName,
           icon_url: iconURL,
           text: lines.join("\r") }}

const postRequest = message => {
  return got.post({ url : webhookURL,
                    json : { response_type : "in_channel",
                             channel       :  requestChannel,
                             text          :  message,
                             icon_url      :  iconURL,
                             username      :  appName } })}

app.listen(port, () => console.log(`${appName} is listening at http://localhost:${port}`))
app.use(bodyParser.urlencoded({ extended: true }))
app.use(path.join(basedir, 'assets'), express.static(path.join(__dirname, 'assets')))

app.get(basedir, (req, res) => res.send(`${appName} is running.`))

app.post(path.join(basedir), function (req, res) {
  if(req.body.token !== token) {
    res.send('Invalid token')
    return }
  let [command, argument] = req.body.text
    .trim()
    .match(/^(\S*) *(.*)?$/)
    .slice(1,3)
    .map(x => x ? x.trim() : undefined)
  switch (command) {
    case "list":
      subscribed = journals
        .filter( j => j.channels.includes(req.body.channel_name))
        .map(j => `* ${j.name} ⇒ [RSS Feed](${j.feedURL})`)
      listMessage = subscribed.length == 0 ?
        "In diesem Kanal sind keine Zeitschriften abboniert." :
        subscribed.length == 1 ?
          "In diesem Kanal ist eine Zeitschrift abboniert:" :
          `In diesem Kanal sind ${subscribed.length} Zeitschriften abboniert:`
      res.json(buildMessage([listMessage].concat(subscribed)))
      break
    case "request":
    case "cancel":
      if (argument) {
        postRequest(`**${ {request: "Subscription",
                           cancel: "Cancellation"}[command]} request** from @${req.body.user_name} in ${req.body.channel_name}: ${argument}`)
        .then(() => res.json(buildMessage([
          {request: "Die Anfrage wurde übermittelt.",
           cancel: "Die Abbestellung wurde in Auftrag gegeben."}[command]
        ])))
      } else {
        res.json(buildMessage([`Welche Zeitschrift soll ${
          { request: "abonniert",
            cancel: "abbestellt"}[command]
        } werden?`,
          `\`/journals ${command} [Name oder URL einer Zeitschrift]\``]))}
      break
    case "help":
    case "":
    case undefined:
      res.json(buildMessage(helpMessage))
      break
    default:
      res.json(buildMessage(["Unbekannter Befehl ¯\\\\_(ツ)_/¯", ""].concat(helpMessage))) }})
