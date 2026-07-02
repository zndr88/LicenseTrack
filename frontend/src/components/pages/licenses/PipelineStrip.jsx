export default function PipelineStrip({ stats, onStageClick, activeFilters }) {
  const stages = [
    { key: 'sourcing',  label: 'Sourcing',  color: 'renewed' },
    { key: 'pending',   label: 'Pending',   color: 'pending' },
    null,
    { key: 'active',    label: 'Active',    color: 'active' },
    { key: 'expiring',  label: 'Expiring',  color: 'expiring' },
    { key: 'expired',   label: 'Expired',   color: 'expired' },
    { key: 'renewed',   label: 'Renewed',   color: 'renewed' },
  ]

  return (
    <div className="kp">
      {stages.map((stage, i) => {
        if (stage === null) return <div key="sep" className="kp-sep" />

        const count = stats?.[stage.key] ?? 0
        const isActive = activeFilters?.includes?.(stage.key)
        const showArrow = i < stages.length - 1 && stages[i + 1] !== null

        const numClass = [
          'kp-num',
          count === 0 ? 'kp-num--zero' : '',
          stage.color ? `kp-num--${stage.color}` : '',
        ].filter(Boolean).join(' ')

        return (
          <div key={stage.key} style={{ display: 'contents' }}>
            <button
              className={`kp-stage${isActive ? ' kp-stage--active' : ''}`}
              onClick={() => onStageClick(stage.key)}
              aria-pressed={isActive}
            >
              <span className={numClass}>{count}</span>
              <span className="kp-label">{stage.label}</span>
            </button>
            {showArrow && <div className="kp-arrow" aria-hidden="true">→</div>}
          </div>
        )
      })}
    </div>
  )
}
