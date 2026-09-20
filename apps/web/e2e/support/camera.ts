/**
 * The scripted camera the browser tests drive (CAM-01 … CAM-14, §16.3 steps 7–10).
 *
 * `getUserMedia` returns a canvas stream playing the rendered scenes in `data/fixtures/camera`
 * — a lot of onions, a dark shed, a lot too far away, a wall — and can be told to refuse the way
 * a real phone refuses: denied, dismissed, busy, over-constrained, no camera, out of memory.
 * Everything downstream of `getUserMedia` is the production code, including the grader.
 *
 * It lives here rather than inside one spec because Gate C walks the failure paths with it and
 * the §16 rehearsal walks the demonstration with it, and they must be driving the same camera.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Page } from '@playwright/test';

export const FIXTURES = resolve(import.meta.dirname, '../../../../data/fixtures/camera');
export const scene = (name: string) => readFileSync(join(FIXTURES, `${name}.jpg`));
const dataUrl = (name: string) => `data:image/jpeg;base64,${scene(name).toString('base64')}`;
export const SCENES = ['onion-lot', 'onion-dark', 'onion-far', 'wall'];

export interface FakeCamera {
  scene: string;
  shake: boolean;
  errors: { name: string; message: string }[];
  permission: PermissionState;
  failResize: number;
  calls: unknown[];
  tracks: MediaStreamTrack[];
}

declare global {
  interface Window {
    __camera: FakeCamera;
  }
}

/** Replace the camera with a scripted one before any page script runs. */
export async function fakeCamera(page: Page, scenes: string[] = SCENES) {
  const images = Object.fromEntries(scenes.map((s) => [s, dataUrl(s)]));
  await page.addInitScript((sources: Record<string, string>) => {
    const camera = { scene: 'onion-lot', shake: false, errors: [], permission: 'granted', failResize: 0, calls: [], tracks: [] } as unknown as FakeCamera;
    window.__camera = camera;
    const loaded: Record<string, HTMLImageElement> = {};
    for (const [name, src] of Object.entries(sources)) {
      const img = new Image();
      img.src = src;
      loaded[name] = img;
    }
    const media = navigator.mediaDevices ?? ({} as MediaDevices);
    Object.defineProperty(navigator, 'mediaDevices', { value: media, configurable: true });
    media.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      camera.calls.push(JSON.parse(JSON.stringify(constraints ?? null)));
      const error = camera.errors.shift();
      if (error !== undefined) throw new DOMException(error.message, error.name);
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const context = canvas.getContext('2d')!;
      let running = true;
      const draw = () => {
        if (!running) return;
        const img = loaded[camera.scene];
        context.fillStyle = 'black';
        context.fillRect(0, 0, 640, 480);
        if (img?.complete) {
          const dx = camera.shake ? (Math.random() - 0.5) * 160 : 0;
          const dy = camera.shake ? (Math.random() - 0.5) * 120 : 0;
          context.drawImage(img, dx, dy, 640, 480);
        }
        setTimeout(draw, 60);
      };
      draw();
      const stream = canvas.captureStream(15);
      for (const track of stream.getTracks()) {
        camera.tracks.push(track);
        const stop = track.stop.bind(track);
        track.stop = () => {
          running = false;
          stop();
        };
      }
      return stream;
    };
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (async (descriptor: PermissionDescriptor) =>
      descriptor.name === ('camera' as PermissionName) ? ({ state: camera.permission, name: 'camera' } as PermissionStatus) : query(descriptor)) as typeof navigator.permissions.query;
    // CAM-08: a phone out of memory fails the burst's resized frames (the viewfinder's are unresized).
    const create = window.createImageBitmap.bind(window);
    window.createImageBitmap = ((source: ImageBitmapSource, ...rest: unknown[]) => {
      const options = rest[rest.length - 1] as ImageBitmapOptions | undefined;
      if (options?.resizeWidth !== undefined && camera.failResize > 0) {
        camera.failResize--;
        return Promise.reject(new RangeError('Array buffer allocation failed'));
      }
      return (create as (...a: unknown[]) => Promise<ImageBitmap>)(source, ...rest);
    }) as typeof window.createImageBitmap;
  }, images);
}

export const set = (page: Page, patch: Partial<Omit<FakeCamera, 'calls' | 'tracks'>>) => page.evaluate((p) => Object.assign(window.__camera, p), patch);
export const calls = (page: Page) => page.evaluate(() => window.__camera.calls.length);
export const allStopped = (page: Page) => page.evaluate(() => window.__camera.tracks.length > 0 && window.__camera.tracks.every((t) => t.readyState === 'ended'));

/** A scene as a file the `<input type="file">` path can take (CAM-01, CAM-07). */
export const photoFile = (name: string) => ({ name: `IMG_${name}.jpg`, mimeType: 'image/jpeg', buffer: scene(name) });
