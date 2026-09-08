import { describe, it, expect } from 'vitest'
import { norm, host, otherCountry, cleanName, matchKind, brandRoot, decideMatch, REGION,
  brandKeys, sameBrand, rankPlaces } from './places-match.js'

/**
 * Все случаи ниже — с боевых карточек. Каждый из них когда-то приводил
 * к неверным данным в карточке клиента, поэтому проверяем именно их,
 * а не выдуманные строки.
 */

describe('норма названия', () => {
  it('кириллица и латиница сходятся', () => {
    expect(norm('Саме Бобо')).toBe(norm('Same bobo'))
    expect(norm('Джотто')).toBe('djotto')
  })
  it('знаки и пробелы не влияют', () => {
    expect(norm('Sagna&Pizza')).toBe(norm('sagna pizza'))
  })
})

describe('домен', () => {
  it('снимает протокол, www и путь', () => {
    expect(host('https://www.choparpizza.uz/menu?x=1')).toBe('choparpizza.uz')
    expect(host('')).toBe('')
  })
})

describe('чистка названия карточки', () => {
  it('срезает код рынка в конце', () => {
    expect(cleanName('Line Brew Reserve KZ')).toBe('Line Brew Reserve')
    expect(cleanName('NegroNi  KZ')).toBe('NegroNi')
  })
  it('убирает повтор слова', () => {
    expect(cleanName('Nomsiz Nomsiz')).toBe('Nomsiz')
  })
  it('не трогает нормальное название', () => {
    expect(cleanName('Chopar pizza')).toBe('Chopar pizza')
  })
})

describe('совпадение названия', () => {
  it('«Same bobo» и «Ресторан Саме Бобо» — одно место', () => {
    expect(matchKind('Same bobo', 'Ресторан Саме Бобо').kind).toBe('strong')
  })
  it('«Самарканд Giotto» и «Giotto Samarkand» — одно место', () => {
    expect(matchKind('Самарканд Giotto', 'Giotto Samarkand').kind).toBe('strong')
  })
  it('по одному имени «Диор Саидкилов» неотличим от бутика Dior', () => {
    // Слово «Dior» совпадает целиком, и сверка имён честно говорит «похоже».
    // Отличают подмену страна и отзывы — это проверяется ниже, в decideMatch
    expect(matchKind('Диор Саидкилов', 'Dior').kind).toBe('strong')
  })
  it('«Tekit Sushi» и «Sushita» — разные заведения', () => {
    // Из-за этой пары в карточку клиента попали чужие сайт и соцсети
    expect(matchKind('Tekit Sushi', 'Sushita').kind).toBe('weak')
  })
  it('совпадение только по кухне объясняется словами', () => {
    const r = matchKind('Tekit Sushi', 'Sushi House')
    expect(r.kind).toBe('weak')
    expect(r.why).toMatch(/кухня/)
  })
  it('пиццерия не совпадает с другой пиццерией по слову «pizza»', () => {
    expect(matchKind('Bellissimo pizza', 'Chopar pizza').kind).toBe('weak')
  })
  it('опечатка в написании города не рушит совпадение', () => {
    expect(matchKind('Qazaq Gourmet', 'Restaurant Qazaq Gourmet').kind).toBe('strong')
  })
  it('на пустых строках не падает', () => {
    expect(matchKind('', 'что-то').kind).toBe('weak')
    expect(matchKind('что-то', '').kind).toBe('weak')
  })
  it('объясняет решение человеческим языком', () => {
    expect(matchKind('Jolie', 'Jolie restaurant').why).toBeTruthy()
  })
})

describe('страна находки', () => {
  it('адрес в Азербайджане для узбекского клиента — чужая страна', () => {
    expect(otherCountry('HM8P+9XC, Сумгаит 5011, Азербайджан', 'uz')).toBe(true)
  })
  it('свой Казахстан чужим не считается', () => {
    expect(otherCountry('пр-т Мангилик Ел 29, Астана, Казахстан', 'kz')).toBe(false)
  })
  it('адрес без страны не повод сомневаться', () => {
    expect(otherCountry('Ташкент, Мойкурган 49', 'uz')).toBe(false)
  })
})

describe('регион поиска', () => {
  it('рынок карточки задаёт страну поиска', () => {
    expect(REGION.kz).toBe('KZ')
    expect(REGION.uz).toBe('UZ')
    // Неизвестный рынок в обработчике падает на UZ — здесь важно, что его нет
    expect(REGION.xx).toBeUndefined()
  })
})

describe('корень бренда для счёта точек', () => {
  it('берёт короткое название карточки', () => {
    // Иначе филиал «EVOS Паркентский» становится брендом и сеть схлопывается
    expect(brandRoot('Evos', 'EVOS Паркентский')).toBe('evos')
  })
  it('если карточка длиннее — берёт название с карт', () => {
    expect(brandRoot('Ресторан Саме Бобо у дороги', 'Саме Бобо')).toBe('samebobo')
  })
})

describe('итоговое решение по находке', () => {
  const dior = {
    query: 'Диор Саидкилов', foundName: 'Dior',
    address: 'HM8P+9XC, Сумгаит 5011, Азербайджан', market: 'uz', reviews: 0,
  }
  it('чужая страна перебивает совпадение имени', () => {
    const r = decideMatch(dior)
    expect(r.kind).toBe('weak')
    expect(r.trusted).toBe(false)
  })
  it('место без отзывов не заполняет поля клиента', () => {
    const r = decideMatch({ query: 'Jolie', foundName: 'Jolie restaurant', market: 'uz', reviews: 0 })
    expect(r.kind).toBe('strong')
    expect(r.trusted).toBe(false)
    expect(r.why).toMatch(/отзывов нет/)
  })
  it('живое место в своей стране заполняет поля', () => {
    const r = decideMatch({
      query: 'Same bobo', foundName: 'Ресторан Саме Бобо',
      address: 'Равонак, Самарканд', market: 'uz', reviews: 16,
    })
    expect(r.kind).toBe('strong')
    expect(r.trusted).toBe(true)
  })
  it('совпавший домен сильнее любого имени', () => {
    const r = decideMatch({ query: 'ООО Вкусно', foundName: 'Chopar pizza', bySite: true, reviews: 5 })
    expect(r.kind).toBe('strong')
    expect(r.trusted).toBe(true)
    expect(r.why).toMatch(/сайт/)
  })
  it('выбор человека не оспаривается', () => {
    const r = decideMatch({ query: 'что угодно', foundName: 'совсем другое', picked: true, reviews: 0 })
    expect(r.kind).toBe('strong')
    expect(r.trusted).toBe(true)
  })
  it('казахстанский клиент в Казахстане — не чужая страна', () => {
    const r = decideMatch({
      query: 'Qazaq Gourmet', foundName: 'Restaurant Qazaq Gourmet',
      address: 'пр-т Мангилик Ел 29, Астана, Казахстан', market: 'kz', reviews: 403,
    })
    expect(r.trusted).toBe(true)
  })
})

describe('сети и франшизы', () => {
  it('разные написания одной сети — один бренд', () => {
    const keys = brandKeys('Chitir-chitir somsa', 'Chitr Chitr')
    expect(sameBrand(keys, 'Chitir-chitir somsa')).toBe(true)
    expect(sameBrand(keys, 'Читир читир сомса')).toBe(true)
    expect(sameBrand(keys, 'Chitir Chitir')).toBe(true)
    expect(sameBrand(keys, 'Chitr chitr somsa')).toBe(true)
  })
  it('чужая сомса той же сетью не становится', () => {
    const keys = brandKeys('Chitir-chitir somsa', 'Chitr Chitr')
    expect(sameBrand(keys, 'Rayhon somsa')).toBe(false)
    expect(sameBrand(keys, 'Самарканд сомса')).toBe(false)
  })
  it('родовое название сетью не считается', () => {
    // «Миллий таомлар» — это «национальные блюда», под него подходит пол-города
    expect(brandKeys('Миллий таомлар')).toEqual([])
    expect(sameBrand(brandKeys('Миллий таомлар'), 'Миллий таомлар Чиланзар')).toBe(false)
  })
  it('филиал сети узнаётся по бренду', () => {
    expect(sameBrand(brandKeys('Chopar Pizza'), 'Chopar Pizza Юнусабад')).toBe(true)
  })
})

describe('порядок кандидатов', () => {
  type P = { n: string; r: number }
  const name = (p: P) => p.n
  const rev = (p: P) => p.r
  it('из совпавших наверх идёт самая заметная точка', () => {
    const list = [
      { n: 'Chitir Chitir', r: 12 },
      { n: 'Chitir-chitir somsa', r: 81 },
      { n: 'Chitr chitr somsa', r: 4 },
    ]
    expect(rankPlaces('Chitr Chitr', list, name, rev)[0].n).toBe('Chitir-chitir somsa')
  })
  it('несовпавшее не обгоняет совпавшее, сколько бы отзывов ни было', () => {
    const list = [
      { n: 'Pizza UNO', r: 5000 },
      { n: 'Sushita', r: 3 },
    ]
    expect(rankPlaces('Sushita', list, name, rev)[0].n).toBe('Sushita')
  })
  it('когда не совпало ничего — порядок Google сохраняется', () => {
    const list = [{ n: 'NevoMusic', r: 2 }, { n: 'Другое', r: 900 }]
    expect(rankPlaces('ahror.umurzakov', list, name, rev).map(name)).toEqual(['Другое', 'NevoMusic'])
  })
})
