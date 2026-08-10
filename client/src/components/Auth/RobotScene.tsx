import { useEffect, useRef, useState } from 'react';

/**
 * The brand robot from the 1ma landing, on the sign-in page's right half.
 *
 * Vanilla `@splinetool/runtime` on purpose: the react wrapper
 * (@splinetool/react-spline v4) peer-depends on next.js, which a Vite app
 * must not drag in. The runtime itself is two tiny deps and one dynamic
 * import — the WebGL chunk loads only after this column has real size, so
 * the login form never waits for it. The cursor-tracking hover the owner
 * likes is baked into the scene file itself.
 *
 * Failure and reduced motion both fall back to the parent's static
 * backdrop: this half of the page is decoration and must never be the
 * reason sign-in looks broken.
 */
export default function RobotScene({ scene }: { scene: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  /* The column is `hidden lg:block`, but React mounts this component on a
   * phone all the same — without the gate a display:none canvas would pull
   * the 1.3MB scene over mobile data AND hand Spline a zero-size
   * framebuffer (the landing hit exactly that: GL_INVALID_FRAMEBUFFER
   * spam). Load only once the desktop query actually matches. */
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );

  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setIsDesktop(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isDesktop) {
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setFailed(true);
      return;
    }
    let disposed = false;
    let app: { dispose: () => void } | null = null;
    import('@splinetool/runtime')
      .then(({ Application }) => {
        if (disposed) {
          return;
        }
        const instance = new Application(canvas);
        app = instance;
        return instance.load(scene).then(() => {
          if (!disposed) {
            setReady(true);
          }
        });
      })
      .catch(() => {
        if (!disposed) {
          setFailed(true);
        }
      });
    return () => {
      disposed = true;
      app?.dispose();
    };
  }, [scene, isDesktop]);

  if (failed) {
    return null;
  }

  /* The robot's rendered size follows the CANVAS height (the scene camera
   * fits vertically), and the scene was framed for the landing's wide hero —
   * full column height cropped the arms at this half-page aspect.
   * (setZoom was tried first and the scene's own camera ignored it.)
   * 85% height keeps the arms in frame; bottom-anchoring puts the scene's
   * own leg cut-off ON the page edge, where a crop reads as composition —
   * centered, the same cut floated mid-air as a hard artefact. */
  return (
    <div className="flex h-full w-full items-end justify-center">
      <div className="h-[85%] w-full">
        <canvas
          ref={canvasRef}
          className="h-full w-full transition-opacity duration-500"
          style={{ opacity: ready ? 1 : 0 }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
