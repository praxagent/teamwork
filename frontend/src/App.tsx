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
  // pushed off screen.  We expose the real visible height (--app-height)
  // AND the visual viewport's offset from the layout top (--app-top) so a
  // `position:fixed` root can be anchored to the *visible* area instead of
  // the layout-viewport top.  Without --app-top, when Safari scrolls a
  // focused input into view the fixed container stays at layout top:0,
  // drifts out from under the visible region, and leaves empty space below
  // the input ("the box jumps to the top").  offsetTop changes on scroll,
  // not just resize, so we listen to both.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const root = document.documentElement.style;
      root.setProperty('--app-height', `${vv.height}px`);
      root.setProperty('--app-top', `${vv.offsetTop}px`);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
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
