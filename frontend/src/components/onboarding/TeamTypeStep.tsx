import { Code, GraduationCap, Users, Sparkles, BookOpen, Target } from 'lucide-react';

interface TeamTypeStepProps {
  onSelect: (type: 'software' | 'coaching') => void;
}

export function TeamTypeStep({ onSelect }: TeamTypeStepProps) {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-slack-purple/10 rounded-full mb-4">
          <Users className="w-8 h-8 text-slack-purple" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Choose Your Team Type
        </h1>
        <p className="text-gray-600">
          Select the type of AI team you want to create for your project.
        </p>
      </div>

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
          onClick={() => onSelect('coaching')}
        />
      </div>

      <div className="mt-8 text-center text-sm text-gray-500">
        <p>Both team types include personalized AI personalities and real-time chat.</p>
      </div>
    </div>
  );
}

interface TeamTypeCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  features: string[];
  accentColor: 'blue' | 'purple';
  onClick: () => void;
}

function TeamTypeCard({ icon, title, description, features, accentColor, onClick }: TeamTypeCardProps) {
  const colorClasses = accentColor === 'blue'
    ? {
        bg: 'bg-blue-50',
        border: 'border-blue-200 hover:border-blue-400',
        iconBg: 'bg-blue-100',
        iconColor: 'text-blue-600',
        checkColor: 'text-blue-500',
      }
    : {
        bg: 'bg-purple-50',
        border: 'border-purple-200 hover:border-purple-400',
        iconBg: 'bg-purple-100',
        iconColor: 'text-purple-600',
        checkColor: 'text-purple-500',
      };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`p-6 text-left border-2 rounded-xl ${colorClasses.border} hover:shadow-lg transition-all duration-200 group`}
    >
      <div className={`inline-flex items-center justify-center w-14 h-14 ${colorClasses.iconBg} rounded-xl mb-4 ${colorClasses.iconColor} group-hover:scale-110 transition-transform`}>
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
