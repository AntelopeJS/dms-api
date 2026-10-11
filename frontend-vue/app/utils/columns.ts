/**
 * Column counts a `ColumnsLayout` steps through as it narrows: halving from
 * the widest, so four cards go 4 → 2 → 1 and never leave one orphan on a
 * second line of three.
 */
export function columnSteps(columns: number): number[] {
  const steps: number[] = []
  for (let count = Math.max(1, Math.floor(columns)); count > 1; ) {
    steps.push(count)
    count = Math.floor(count / 2)
  }
  return [...steps, 1].reverse()
}

/**
 * The stylesheet of one `ColumnsLayout`: a single column, then each wider
 * step once its container fits that many columns at `minColumnWidth`. Pure
 * CSS on the container's own width, so the server render and the browser
 * agree from the first paint.
 */
export function columnsStylesheet(
  scope: string,
  columns: number,
  minColumnWidth: string,
  gap: string,
): string {
  const cells = `[data-api-columns="${scope}"]`
  const template = (count: number) =>
    `${cells} { grid-template-columns: repeat(${count}, minmax(0, 1fr)); }`
  return columnSteps(columns)
    .map((count) =>
      count === 1
        ? template(1)
        : `@container ${scope} (width >= calc(${count} * ${minColumnWidth} + ${count - 1} * ${gap})) { ${template(count)} }`,
    )
    .join('\n')
}
