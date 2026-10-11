import { describe, expect, it } from 'vitest'
import { cardAfter, type WalkedElement } from '../app/utils/liveTable'

interface FakeNode extends WalkedElement {
  name: string
  card: boolean
  children: FakeNode[]
}

function node(name: string, card = false, children: FakeNode[] = []): FakeNode {
  const self: FakeNode = {
    name,
    card,
    children,
    parentElement: null,
    nextElementSibling: null,
    matches: () => self.card,
    querySelector: () => findCard(self.children),
  }
  children.forEach((child, index) => {
    child.parentElement = self
    child.nextElementSibling = children[index + 1] ?? null
  })
  return self
}

function findCard(nodes: FakeNode[]): FakeNode | null {
  for (const each of nodes) {
    if (each.card) return each
    const inner = findCard(each.children)
    if (inner) return inner
  }
  return null
}

describe('cardAfter', () => {
  it('finds the table in the block after the banner, rows or not', () => {
    const anchor = node('anchor')
    const filters = node('filters', false, [node('filters-card', true)])
    node('stack', false, [
      filters,
      node('banner-block', false, [anchor]),
      node('table-block', false, [
        node('wrapper', false, [node('card', true)]),
      ]),
    ])
    expect(cardAfter(anchor)?.name).toBe('card')
  })

  it('finds nothing after the last block', () => {
    const anchor = node('anchor')
    node('stack', false, [node('card-before', true), anchor])
    expect(cardAfter(anchor)).toBeNull()
  })
})
