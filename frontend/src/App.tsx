import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Home, ProjectWorkspace, Projects } from '@/pages';
import { OnboardingWizard } from '@/components/onboarding';
import { ToastContainer } from '@/components/common';
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

  // Mobile: auto-fullscreen video elements on play
  useEffect(() => {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (!isMobile) return;
    const handler = (e: Event) => {
      const video = e.target as HTMLVideoElement;
      if (video.tagName === 'VIDEO' && video.requestFullscreen) {
        video.requestFullscreen().catch(() => {});
      }
    };
    document.addEventListener('play', handler, true);
    return () => document.removeEventListener('play', handler, true);
  }, []);

  // iOS Safari: fix keyboard hiding the send button.
  // Safari shrinks the visual viewport when the keyboard opens but
  // doesn't shrink the layout viewport — so fixed/flex elements get
  // pushed off screen.  We set a CSS variable to the real visible
  // height so components can use it instead of 100vh.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      document.documentElement.style.setProperty(
        '--app-height',
        `${vv.height}px`,
      );
    };
    update();
    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/new" element={<OnboardingWizard />} />
        <Route path="/project/:projectId" element={<ProjectWorkspace />} />
      </Routes>
      <ToastContainer />
    </BrowserRouter>
  );
}

export default App;
