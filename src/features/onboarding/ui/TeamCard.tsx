interface TeamCardProps {
  team: Record<string, string>
  roles: Array<{ id: string; name: string; color: string }>
  agents: Array<{ id: string; name: string }>
}

export function TeamCard({ team, roles, agents }: TeamCardProps) {
  const agentMap = new Map(agents.map((a) => [a.id, a.name]))

  const assignments = roles
    .filter((r) => team[r.id])
    .map((role) => ({
      role,
      agentName: agentMap.get(team[role.id]) ?? 'Не назначен',
    }))

  return (
    <div className="rounded-xl bg-blue-50/60 p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">
        Команда подключения
      </h3>

      {assignments.length === 0 && (
        <p className="text-sm text-gray-400">Команда не назначена</p>
      )}

      <div className="flex flex-wrap gap-2">
        {assignments.map(({ role, agentName }) => {
          const initial = agentName[0].toUpperCase()
          return (
            <div
              key={role.id}
              className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 shadow-sm"
              style={{ borderLeft: `3px solid ${role.color}` }}
            >
              <div
                className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: role.color }}
              >
                {initial}
              </div>
              <span className="text-sm text-gray-700">
                {role.name}: <span className="font-medium">{agentName}</span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
