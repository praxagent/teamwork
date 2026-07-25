import { Code, GraduationCap, Users, Sparkles, MessageSquare } from 'lucide-react';

interface TeamTypeStepProps {
  onSelect: (type: 'software' | 'coaching') => void;
  /** Skip the wizard entirely: one project, one agent, straight into chat. */
  onBlank?: () => void;
}

/**
 * Startup / Personal Coaching are DISABLED, not deleted.
 *
 * Their backend went away in v0.2.0 ("pure display shell"): the wizard still
 * calls /api/onboarding/start, /auto-answer, finalize and shuffle-member, and
 * none of those routes exist any more — clicking either card 404s on step one.
 *
 * They stay on screen, greyed, because they encode the only worked-through
 * answer to "what should a team of agents look like", and that becomes live
 * again once **Prax** can compose and drive a team over /api/external. TeamWork
 * has no LLM and should not grow one; it should render a team the agent builds.
 */
const TEAM_TYPES_ENABLED = false;

export function TeamTypeStep({ onSelect, onBlank }: TeamTypeStepProps) {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-500/10 rounded-full mb-4">
          <Users className="w-8 h-8 text-indigo-600" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Choose Your Team Type
        </h1>
        <p className="text-gray-600">
          Start with a blank workspace, or pick a pre-built team.
        </p>
      </div>

      {onBlank && (
        <div className="mb-6">
          <TeamTypeCard
            icon={<MessageSquare className="w-8 h-8" />}
            title="Just Prax"
            description="A blank workspace — start talking to your agent straight away"
            features={[
              "One project, one agent",
              "No setup questions",
              "Straight into #general",
            ]}
            accentColor="green"
            onClick={onBlank}
          />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <TeamTypeCard
          icon={<Code className="w-8 h-8" />}
          title="Startup"
          description="Build your product with a virtual development team"
          features={[
            "Product Manager to lead",
            "Developers to build features",
            "QA Engineers for quality",
            "Kanban board & task tracking",
          ]}
          accentColor="blue"
          disabled={!TEAM_TYPES_ENABLED}
          onClick={() => onSelect('software')}
        />
        <TeamTypeCard
          icon={<GraduationCap className="w-8 h-8" />}
          title="Personal Coaching"
          description="Learn and improve skills with AI coaches"
          features={[
            "Personal Manager for motivation",
            "Expert coaches per topic",
            "Progress tracking",
            "Proactive check-ins",
          ]}
          accentColor="purple"
          disabled={!TEAM_TYPES_ENABLED}
          onClick={() => onSelect('coaching')}
        />
      </div>

      <div className="mt-8 text-center text-sm text-gray-500">
        <p>
          {TEAM_TYPES_ENABLED
            ? 'Both team types include personalized AI personalities and real-time chat.'
            : 'Pre-built teams are temporarily unavailable — they are being rebuilt so the agent composes and drives the team.'}
        </p>
      </div>
    </div>
  );
}

interface TeamTypeCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  features: string[];
  accentColor: 'blue' | 'purple' | 'green';
  onClick: () => void;
  disabled?: boolean;
}

function TeamTypeCard({ icon, title, description, features, accentColor, onClick, disabled = false }: TeamTypeCardProps) {
  const palettes = {
    blue: { border: 'border-blue-200 hover:border-blue-400', iconBg: 'bg-blue-100',
            iconColor: 'text-blue-600', checkColor: 'text-blue-500' },
    purple: { border: 'border-purple-200 hover:border-purple-400', iconBg: 'bg-purple-100',
              iconColor: 'text-purple-600', checkColor: 'text-purple-500' },
    green: { border: 'border-emerald-200 hover:border-emerald-400', iconBg: 'bg-emerald-100',
             iconColor: 'text-emerald-600', checkColor: 'text-emerald-500' },
  } as const;
  const colorClasses = palettes[accentColor];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled}
      title={disabled ? 'Temporarily unavailable — being rebuilt' : undefined}
      className={`relative p-6 text-left border-2 rounded-xl transition-all duration-200 group ${
        disabled
          ? 'border-gray-200 opacity-60 cursor-not-allowed'
          : `${colorClasses.border} hover:shadow-lg`
      }`}
    >
      {disabled && (
        <span className="absolute top-3 right-3 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide
                         rounded-full bg-gray-200 text-gray-600">
          Coming soon
        </span>
      )}
      <div className={`inline-flex items-center justify-center w-14 h-14 ${colorClasses.iconBg} rounded-xl mb-4 ${colorClasses.iconColor} ${disabled ? '' : 'group-hover:scale-110'} transition-transform`}>
        {icon}
      </div>
      <h3 className="text-xl font-bold text-gray-900 mb-2">{title}</h3>
      <p className="text-gray-600 mb-4">{description}</p>
      <ul className="space-y-2">
        {features.map((feature, i) => (
          <li key={i} className="flex items-center gap-2 text-sm text-gray-700">
            <Sparkles className={`w-4 h-4 ${colorClasses.checkColor}`} />
            {feature}
          </li>
        ))}
      </ul>
    </button>
  );
}
