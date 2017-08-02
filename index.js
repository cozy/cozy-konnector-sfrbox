const moment = require('moment')

const {log, BaseKonnector, saveBills, request, retry} = require('cozy-konnector-libs')

let rq = request({
  cheerio: true,
  json: false,
  jar: true,
  // debug: true,
  headers: {}
})

module.exports = new BaseKonnector(function fetch (fields) {
  return retry(getToken, {
    interval: 5000,
    throw_original: true
  })
  .then(token => logIn(token, fields))
  .then(() => retry(fetchBillsAttempts, {
    interval: 5000,
    throw_original: true
  }))
  .then(entries => saveBills(entries, fields.folderPath, {
    timeout: Date.now() + 60 * 1000,
    identifiers: ['SFR FIXE', 'SFR ADSL']
  }))
  .catch(err => {
    // Connector is not in error if there is not entry in the end
    // It may be simply an empty account
    if (err.message === 'NO_ENTRY') return []
    throw err
  })
})

// Procedure to get the login token
function getToken () {
  log('info', 'Logging in on Sfr Website...')
  return rq('https://www.sfr.fr/bounce?target=//www.sfr.fr/sfr-et-moi/bounce.html&casforcetheme=mire-sfr-et-moi&mire_layer')
  .then($ => $('input[name=lt]').val())
  .then(token => {
    if (!token) throw new Error('BAD_TOKEN')
    return token
  })
}

function logIn (token, fields) {
  return rq({
    method: 'POST',
    url: 'https://www.sfr.fr/cas/login?domain=mire-sfr-et-moi&service=https://www.sfr.fr/accueil/j_spring_cas_security_check#sfrclicid=EC_mire_Me-Connecter',
    form: {
      lt: token,
      execution: 'e1s1',
      _eventId: 'submit',
      username: fields.login,
      password: fields.password,
      identifier: ''
    }
  })
  .then($ => {
    const badLogin = $('#username').length > 0
    if (badLogin) throw new Error('bad login')
  })
  .catch(err => {
    log('info', err.message, 'Error while logging in')
    throw new Error('LOGIN_FAILED')
  })
}

function fetchBillsAttempts () {
  return fetchBillingInfo()
  .then(parsePage)
  .then(entries => {
    if (entries.length === 0) throw new Error('NO_ENTRY')
    return entries
  })
}

function fetchBillingInfo () {
  log('info', 'Fetching bill info')
  return rq('https://espace-client.sfr.fr/facture-fixe/consultation')
  .catch(err => {
    log('error', err.message, 'Error while fetching billing info')
    throw err
  })
}

function parsePage ($) {
  const result = []
  moment.locale('fr')
  const baseURL = 'https://espace-client.sfr.fr'

  const firstBill = $('#facture')
  const firstBillUrl = $('#lien-telecharger-pdf').attr('href')

  if (firstBillUrl) {
    // The year is not provided, but we assume this is the current year or that
    // it will be provided if different from the current year
    let firstBillDate = firstBill.find('tr.header h3').text().substr(17)
    firstBillDate = moment(firstBillDate, 'D MMM YYYY')

    const price = firstBill.find('tr.total td.prix').text()
                                                    .replace('€', '')
                                                    .replace(',', '.')

    const bill = {
      date: firstBillDate.toDate(),
      amount: parseFloat(price),
      fileurl: `${baseURL}${firstBillUrl}`,
      filename: getFileName(firstBillDate),
      vendor: 'SFR BOX'
    }

    result.push(bill)
  } else {
    log('info', 'wrong url for first PDF bill.')
  }

  $('#tab tr').each(function each () {
    let date = $(this).find('.date').text()
    let prix = $(this).find('.prix').text()
                                    .replace('€', '')
                                    .replace(',', '.')
    let pdf = $(this).find('.liens a').attr('href')

    if (pdf) {
      date = date.split(' ')
      date.pop()
      date = date.join(' ')
      date = moment(date, 'D MMM YYYY')
      prix = parseFloat(prix)
      pdf = `${baseURL}${pdf}`

      const bill = {
        date: date.toDate(),
        amount: prix,
        fileurl: pdf,
        filename: getFileName(date),
        vendor: 'SFR BOX'
      }

      result.push(bill)
    } else {
      log('info', 'wrong url for PDF bill.')
    }
  })

  log('info', 'Successfully parsed the page')

  return result
}

function getFileName (date) {
  return `${date.format('YYYYMM')}_sfr.pdf`
}
