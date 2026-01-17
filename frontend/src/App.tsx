import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Home, ProjectWorkspace, Projects } from '@/pages';
import { OnboardingWizard } from '@/components/onboarding';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/new" element={<OnboardingWizard />} />
        <Route path="/project/:projectId" element={<ProjectWorkspace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
