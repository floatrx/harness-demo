import type { AgentActivity } from '@/lib/unit-trace';
import { ClaudeSpinner } from '@/components/ui/claude-spinner';
import { Elapsed } from '@/components/ui/elapsed';
import { RoleAvatar } from '@/components/ui/role-avatar';

interface Props {
  agent: AgentActivity;
}

const seconds = (from: string, to: string) => {
  const total = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export const AgentRow = ({ agent }: Props) => (
  <li className="flex gap-2" data-testid="agent-row">
    <RoleAvatar role={agent.role} state={agent.state === 'running' ? 'live' : 'done'} />
    <div className="min-w-0 text-[12.5px]">
      <p className="flex items-center gap-1">
        <b className={agent.state === 'running' ? 'text-accent' : agent.state === 'failed' ? 'text-danger' : ''}>
          {agent.role}
        </b>
        {agent.state === 'running' ? (
          <ClaudeSpinner size="sm" />
        ) : (
          <span className="text-muted">{agent.state === 'failed' ? '✕' : '✓'}</span>
        )}
        <span className="text-muted tabular-nums">
          {agent.startedAt &&
            (agent.endedAt ? seconds(agent.startedAt, agent.endedAt) : <Elapsed since={agent.startedAt} />)}
        </span>
      </p>
      {agent.tool && (
        <p className="truncate text-xs text-muted">
          {agent.tool}
          {agent.file && ` · ${agent.file}`} · {agent.calls} call{agent.calls === 1 ? '' : 's'}
        </p>
      )}
    </div>
  </li>
);
