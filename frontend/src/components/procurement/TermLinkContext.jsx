export default function TermLinkContext({ item, items }) {
  const predecessors = items.filter((candidate) => candidate.successorSourcingItemId === item.id);
  const successor = items.find((candidate) => candidate.id === item.successorSourcingItemId);
  if (!predecessors.length && !successor) return null;
  const label = (line) => line.softwareDescription || `Line #${line.id}`;
  return (
    <div className="term-link-context">
      {predecessors.length > 0 && <span>Follows {predecessors.map(label).join(", ")}</span>}
      {successor && <span>Next term: {label(successor)}</span>}
    </div>
  );
}
