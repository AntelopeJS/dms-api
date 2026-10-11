import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

// A tooltip anchors on its first child (Reka `asChild`). The DMS components
// load asynchronously: one still loading has no element yet, and the
// tooltip reading it throws "Cannot read properties of null (reading
// 'nodeName')", which replaced the whole Routes page on a direct load of
// the Tester (RT3-1). A tooltip wraps a plain element or a Nuxt UI one.
const COMPONENTS = join(__dirname, '../app/components')

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? vueFiles(join(dir, entry.name))
      : entry.name.endsWith('.vue')
        ? [join(dir, entry.name)]
        : [],
  )
}

/** The tag of the first element each `<UTooltip>` of `source` wraps. */
function tooltipTriggers(source: string): string[] {
  const triggers: string[] = []
  const open = /<UTooltip\b(?:[^>"']|"[^"]*"|'[^']*')*>/g
  for (let match = open.exec(source); match; match = open.exec(source)) {
    const rest = source.slice(match.index + match[0].length)
    const child = /<(?!!--)([A-Za-z][\w-]*)/.exec(
      rest.replace(/<!--[\s\S]*?-->/g, ''),
    )
    if (child) triggers.push(child[1] as string)
  }
  return triggers
}

it('reads the trigger each tooltip wraps', () => {
  expect(
    tooltipTriggers(
      '<UTooltip :text="a > b ? \'x\' : \'y\'">\n<!-- <DmsCard> -->\n<span tabindex="0"><DmsStatusPill /></span></UTooltip>',
    ),
  ).toEqual(['span'])
})

it('anchors no tooltip on a DMS component, which loads asynchronously', () => {
  const offenders = vueFiles(COMPONENTS).flatMap((file) =>
    tooltipTriggers(readFileSync(file, 'utf8'))
      .filter((tag) => /^Dms/.test(tag))
      .map((tag) => `${file}: <${tag}>`),
  )
  expect(offenders).toEqual([])
})
