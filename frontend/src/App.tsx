import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Home, ProjectWorkspace, Projects } from '@/pages';
import { OnboardingWizard } from '@/components/onboarding';
import { useUIStore } from '@/stores';

function App() {
  // Subscribe to dark mode changes and apply to document
  const darkMode = useUIStore((state) => state.darkMode);

  useEffect(() => {
    // Apply dark mode class to html element
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

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
