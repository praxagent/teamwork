import { useState } from 'react';
import { Button, TextArea } from '@/components/common';
import { MessageCircle, Sparkles } from 'lucide-react';

interface ClarifyingQuestionsProps {
  questions: string[];
  projectName: string;
  onSubmit: (answers: string[]) => void;
  onBack: () => void;
  onAutoAnswer?: () => Promise<string[]>;
  loading?: boolean;
  autoAnswerLoading?: boolean;
  quickLaunching?: boolean;
}

export function ClarifyingQuestions({
  questions,
  projectName,
  onSubmit,
  onBack,
  onAutoAnswer,
  loading,
  autoAnswerLoading,
  quickLaunching,
}: ClarifyingQuestionsProps) {
  const [answers, setAnswers] = useState<string[]>(questions.map(() => ''));

  const handleAnswerChange = (index: number, value: string) => {
    const newAnswers = [...answers];
    newAnswers[index] = value;
    setAnswers(newAnswers);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(answers);
  };

  const handleAutoAnswer = async () => {
    if (onAutoAnswer) {
      const generatedAnswers = await onAutoAnswer();
      setAnswers(generatedAnswers);
    }
  };

  const allAnswered = answers.every((a) => a.trim().length > 0);
  const isLoading = loading || autoAnswerLoading;

  // Show simplified loading view during quick launch
  if (quickLaunching) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4 animate-pulse">
            <Sparkles className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Answering Questions
          </h1>
          <p className="text-gray-600">
            AI is answering the refining questions for <span className="font-semibold">{projectName}</span>...
          </p>
          <div className="mt-6 flex justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-green-500 border-t-transparent" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
          <MessageCircle className="w-8 h-8 text-green-600" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          A Few Quick Questions
        </h1>
        <p className="text-gray-600">
          Help us understand your vision for <span className="font-semibold">{projectName}</span> better
          so we can build the perfect team.
        </p>
        
        {onAutoAnswer && (
          <Button
            type="button"
            variant="ghost"
            onClick={handleAutoAnswer}
            disabled={isLoading}
            className="mt-4 text-slack-active hover:text-blue-700"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            {autoAnswerLoading ? 'Thinking...' : 'Just answer for me'}
          </Button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {questions.map((question, index) => (
          <div key={index} className="bg-white p-4 rounded-lg border border-gray-200">
            <label className="block text-sm font-medium text-gray-900 mb-2">
              {index + 1}. {question}
            </label>
            <TextArea
              value={answers[index]}
              onChange={(e) => handleAnswerChange(index, e.target.value)}
              placeholder="Your answer..."
              rows={3}
              disabled={isLoading}
            />
          </div>
        ))}

        <div className="flex justify-between pt-4">
          <Button type="button" variant="ghost" onClick={onBack} disabled={isLoading}>
            Back
          </Button>
          <Button type="submit" disabled={!allAnswered || isLoading} loading={loading}>
            {loading ? 'Analyzing...' : 'Continue'}
          </Button>
        </div>
      </form>
    </div>
  );
}
