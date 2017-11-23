import EDTF = require('edtf')
import edtfy = require('edtfy')
import debug = require('./debug.ts')

// import escapeStringRegexp = require('escape-string-regexp')

const months = require('../gen/dateparser-data.json')
const months_re = new RegExp(Object.keys(months).sort((a, b) => b.length - a.length).join('|'), 'i')

/*
regex = {
  My: new RegExp('^(' + months.english.join('|') + ')\\s([0-9]{3,})$', 'i'),
  Mdy: new RegExp('^(' + months.english.join('|') + ')\\s([0-9]{1,2})\\s*,\\s*([0-9]{3,})$', 'i'),
  dMy: new RegExp('^([0-9]{1,2})\\.?\\s+(' + months.english.join('|') + ')\\s+([0-9]{3,})$', 'i'),
}
*/

const SPRING = 21
const WINTER = 24

function seasonize(date) {
  if (date.type === 'date' && typeof date.month === 'number' && date.month >= SPRING && date.month <= WINTER && !date.day) {
    return { type: 'season', year: date.year, season: (date.month - SPRING) + 1 }
  }
  return date
}

function normalize_edtf(date) {
  let year, month, day

  switch (date.type) {
    case 'Date':
      [ year, month, day ] = date.values
      if (typeof month === 'number') month += 1
      return { type: 'date', year, month, day, approximate: date.approximate || !!date.unspecified, uncertain: date.uncertain }

//    when 'Set'
//      if date.values.length == 1
//        return { type: 'set', orig: { type: 'date', year: date.values[0].values[0] } }

    case 'Interval':
      // tslint:disable-next-line:no-magic-numbers
      if (date.values.length !== 2) throw new Error(JSON.stringify(date))
      const from = date.values[0] ? normalize_edtf(date.values[0]) : { type: 'open' }
      const to = date.values[1] ? normalize_edtf(date.values[1]) : { type: 'open' }
      return { type: 'interval', from, to }

    case 'Season':
      [ year, month ] = date.values
      if (month < SPRING || month > WINTER) throw new Error(`Unexpected season ${month}`)
      return seasonize({ type: 'date', year, month })

    case 'List':
      return { type: 'list', dates: date.values.map(normalize_edtf) }

    default:
      throw new Error(JSON.stringify(date))
  }
}

function upgrade_edtf(date) {
  return date
    .replace(/unknown/g, '*')
    .replace(/u/g, 'X')
    .replace(/(\?~)|(~\?)/g, '%')
    .replace(/open/g, '')
    .replace(/\.\./g, '')
    .replace(/y/g, 'Y')
}

function parse_edtf(date) {
  try {
    return normalize_edtf(EDTF.parse(edtfy(date.replace(/\. /, ' ')))) // 8. july 2011
  } catch (err) {}

  try {
    // https://github.com/inukshuk/edtf.js/issues/5
    return normalize_edtf(EDTF.parse(upgrade_edtf(date)))
  } catch (err) {}

  return false
}

function parse(value) {
  const december = 12

  debug('dateparser: parsing', value)

  if (value.trim() === '') return {type: 'open'}

  let m
  // 747
  if (m = value.match(/^([a-zA-Z]+)\s+([0-9]+)(?:--|-|–)([0-9]+)[, ]\s*([0-9]+)$/)) {
    const [ , month, day1, day2, year ] = m

    const from = parse(`${month} ${day1} ${year}`)
    const to = parse(`${month} ${day2} ${year}`)

    if (from.type === 'date' && to.type === 'date') return { type: 'interval', from, to }
  }

  // 747, January 30–February 3, 1989
  if (m = value.match(/^([a-zA-Z]+\s+[0-9]+)(?:--|-|–)([a-zA-Z]+\s+[0-9]+)[, ]\s*([0-9]+)$/)) {
    const [ , date1, date2, year ] = m

    const from = parse(`${date1} ${year}`)
    const to = parse(`${date2} ${year}`)

    if (from.type === 'date' && to.type === 'date') return { type: 'interval', from, to }
  }

  // 746
  if (m = value.match(/^([0-9]+)(?:--|-|–)([0-9]+)\s+([a-zA-Z]+)\s+([0-9]+)$/)) {
    const [ , day1, day2, month, year ] = m

    const from = parse(`${month} ${day1} ${year}`)
    const to = parse(`${month} ${day2} ${year}`)

    if (from.type === 'date' && to.type === 'date') return { type: 'interval', from, to }
  }

  for (const sep of ['--', '-', '/', '_', '–']) {
    if ((m = value.split(sep)).length === 2) { // potential range
      const [ _from, _to ] = m
      if ((_from.length > 2 || (sep === '/' && _from.length === 0)) && (_to.length > 2 || (sep === '/' && _to.length === 0))) {
        const from = parse(_from) // tslint:disable-line:no-magic-numbers
        const to = parse(_to)   // tslint:disable-line:no-magic-numbers
        if (['date', 'open'].includes(from.type) && ['date', 'open'].includes(to.type)) return { type: 'interval', from, to }
      }
    }
  }

  const cleaned = value.normalize('NFC').replace(months_re, (_ => months[_.toLowerCase()]))
  debug('dateparser:', value, 'cleaned up to', cleaned)

  const trimmed = cleaned.trim().replace(/(\s+|T)[0-9]{2}:[0-9]{2}:[0-9]{2}(Z|\+[0-9]{2}:?[0-9]{2})?$/, '').toLowerCase()

//  if m = regex.dMy.exec(trimmed)
//    year = parseInt(m[3])
//    day = parseInt(m[1])
//    month = months.english.indexOf(m[2]) + 1
//    month += 8 if month > december
//    return { type: 'date', year, month, day }

//  if m = regex.Mdy.exec(trimmed)
//    year = parseInt(m[3])
//    day = parseInt(m[2])
//    month = months.english.indexOf(m[1]) + 1
//    month += 8 if month > december
//    return { type: 'date', year, month, day }

//  if m = regex.My.exec(trimmed)
//    year = parseInt(m[2])
//    month = months.english.indexOf(m[1]) + 1
//    month += 8 if month > december
//    return { type: 'date', year, month }

  if (m = /^(-?[0-9]{3,})-([0-9]{2})-([0-9]{2})T/.exec(trimmed)) {
    const [ , year, month, day ] = m
    return { type: 'date', year: parseInt(year), month: parseInt(month), day: parseInt(day) }
  }

  // these assume a sensible d/m/y format by default. There's no sane way to guess between m/d/y and d/m/y, and m/d/y is
  // just wrong. https://en.wikipedia.org/wiki/Date_format_by_country
  if (m = /^(-?[0-9]{3,})([-\/\.])([0-9]{1,2})(\2([0-9]{1,2}))?$/.exec(trimmed)) {
    let [ , year, , month, , day ] = m
    if (day && (parseInt(month) > december) && (parseInt(day) < december)) [day, month] = [month, day]
    return seasonize({ type: 'date', year: parseInt(year), month: parseInt(month), day: day ? parseInt(day) : undefined })
  }
  if (m = /^([0-9]{1,2})(?:[-\/\. ])([0-9]{1,2})(?:[-\/\. ])([0-9]{3,})$/.exec(trimmed)) {
    let [ , day, month, year ] = m
    // you can be detectably wrong though
    if (parseInt(month) > december && parseInt(day) < december) [day, month] = [month, day]
    return { type: 'date', year: parseInt(year), month: parseInt(month), day: parseInt(day) }
  }

  if (m = /^([0-9]{1,2})[-\/\.]([0-9]{3,})$/.exec(trimmed)) {
    const [ , month, year ] = m
    return { type: 'date', year: parseInt(year), month: parseInt(month) }
  }

  if (m = /^([0-9]{3,})[-\/\.]([0-9]{1,2})$/.exec(trimmed)) {
    const [ , _year, _month ] = m
    const year = parseInt(_year)
    const month = parseInt(_month)

    return seasonize({ type: 'date', year, month })
  }

//  if m = /^(-?[0-9]{3,})([?~]*)$/.exec(trimmed)
//    return { type: 'date', year: parseInt(m[1]), approximate: m[2].indexOf('~') >=0, uncertain: m[2].indexOf('?') >= 0 }

  if (m = /^\[(-?[0-9]+)\]$/.exec(trimmed)) {
    // 704
    // return { type: 'date', orig: { type: 'date', year: parseInt(m[1]) } }
    return { type: 'verbatim', verbatim: value }
  }

  if (m = /^\[(-?[0-9]+)\]\s*(-?[0-9]+)$/.exec(trimmed)) {
    const [ , orig, year ] = m
    return { type: 'date', year: parseInt(year), orig: { type: 'date', year: parseInt(orig) } }
  }

  if (m = /^(-?[0-9]+)\s*\[(-?[0-9]+)\]$/.exec(trimmed)) {
    const [ , year, orig ] = m
    return { type: 'date', year: parseInt(year), orig: { type: 'date', year: parseInt(orig) } }
  }

  const parsed = parse_edtf(cleaned)
  return parsed || { type: 'verbatim', verbatim: value }
}

export = {
  isEDTF(value, minuteLevelPrecision = false) {
    value = upgrade_edtf(value)

    for (const postfix of ['', minuteLevelPrecision ? ':00' : undefined]) {
      try {
        debug('isEDTF', value + postfix)
        return !!EDTF.parse(value + postfix)
      } catch (err) {
        debug('isEDTF', value + postfix, ': no')
      }
    }

    debug('isEDTF', value, ': definately no')
    return false
  },

  parse,
}
