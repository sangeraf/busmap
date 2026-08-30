/** The stop's extra detail (platform, entrance…), greyed next to its name. */
export function NodeInfo({ info }: { info?: string }) {
  if (!info?.trim()) return null
  return <span className="ml-1 font-normal text-slate-400">{info}</span>
}
