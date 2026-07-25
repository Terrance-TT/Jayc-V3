import type { MetaFunction } from '@remix-run/cloudflare';
import { useSearchParams } from '@remix-run/react';
import { useMemo } from 'react';

export const meta: MetaFunction = () => {
  return [{ title: 'Preview — Jayc' }];
};

/**
 * Only real WebContainer / StackBlitz preview origins may be embedded here.
 * This keeps the page from being abused as an open iframe proxy for
 * arbitrary sites.
 */
const ALLOWED_PREVIEW_HOSTS = ['webcontainer-api.io', 'staticblitz.com'];

function isAllowedPreviewUrl(value: string): boolean {
  try {
    const { protocol, hostname } = new URL(value);

    if (protocol !== 'https:') {
      return false;
    }

    return ALLOWED_PREVIEW_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

/**
 * Full-page preview wrapper.
 *
 * WebContainer preview URLs are session-bound: they load reliably inside an
 * iframe embedded in a Jayc page, but fail (404 / cookie errors) when opened
 * as a top-level tab. This route recreates the working context — a Jayc page
 * on our own origin with a full-screen iframe — so "open in new tab" works
 * regardless of the visitor's third-party cookie settings.
 *
 * The container itself still lives in the editor tab, so that tab must stay
 * open for this page to work.
 */
export default function PreviewPage() {
  const [searchParams] = useSearchParams();
  const previewUrl = searchParams.get('u') ?? '';

  const allowed = useMemo(() => isAllowedPreviewUrl(previewUrl), [previewUrl]);

  if (!allowed) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-bolt-elements-background-depth-1">
        <div className="text-center max-w-md p-6">
          <h1 className="text-lg font-medium text-bolt-elements-textPrimary mb-2">No preview to show</h1>
          <p className="text-sm text-bolt-elements-textSecondary">
            This page displays live Jayc app previews. Open an app in Jayc, wait for its preview to start, then
            use the "open in new tab" button in the preview toolbar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <iframe
      title="App preview"
      className="border-none w-full h-full bg-white"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      src={previewUrl}
    />
  );
}
