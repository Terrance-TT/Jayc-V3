import { useStore } from '@nanostores/react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { IconButton } from '~/components/ui/IconButton';
import { devServerStore } from '~/lib/stores/dev-server.client';
import { workbenchStore } from '~/lib/stores/workbench';
import { PortDropdown } from './PortDropdown';

export const Preview = memo(() => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [activePreviewIndex, setActivePreviewIndex] = useState(0);
  const [isPortDropdownOpen, setIsPortDropdownOpen] = useState(false);
  const hasSelectedPreview = useRef(false);
  const previews = useStore(workbenchStore.previews);
  const devServerStatus = useStore(devServerStore.status);
  const activePreview = previews[activePreviewIndex];

  const [url, setUrl] = useState('');
  const [iframeUrl, setIframeUrl] = useState<string | undefined>();

  useEffect(() => {
    if (!activePreview) {
      setUrl('');
      setIframeUrl(undefined);

      return;
    }

    const { baseUrl } = activePreview;

    setUrl(baseUrl);
    setIframeUrl(baseUrl);
  }, [activePreview, iframeUrl]);

  const validateUrl = useCallback(
    (value: string) => {
      if (!activePreview) {
        return false;
      }

      const { baseUrl } = activePreview;

      if (value === baseUrl) {
        return true;
      } else if (value.startsWith(baseUrl)) {
        return ['/', '?', '#'].includes(value.charAt(baseUrl.length));
      }

      return false;
    },
    [activePreview],
  );

  const findMinPortIndex = useCallback(
    (minIndex: number, preview: { port: number }, index: number, array: { port: number }[]) => {
      return preview.port < array[minIndex].port ? index : minIndex;
    },
    [],
  );

  // when previews change, display the lowest port if user hasn't selected a preview
  useEffect(() => {
    if (previews.length > 1 && !hasSelectedPreview.current) {
      const minPortIndex = previews.reduce(findMinPortIndex, 0);

      setActivePreviewIndex(minPortIndex);
    }
  }, [previews]);

  const reloadPreview = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  };

  const openInNewTab = () => {
    if (!iframeUrl) {
      return;
    }

    /**
     * WebContainer preview URLs only load inside an iframe embedded in a Jayc
     * page — opened as a top-level tab they 404 or break on third-party
     * cookie settings. So the new tab opens our own /preview wrapper route
     * (first-party on our origin) which embeds the container URL full-screen.
     */
    const newTab = window.open(`/preview?u=${encodeURIComponent(iframeUrl)}`, '_blank');

    if (newTab) {
      toast.info('Preview opened in a new tab — keep this tab open or the preview stops working.', {
        autoClose: 8000,
      });
    } else {
      toast.error('Your browser blocked the new tab. Allow pop-ups for this site, then try again.', {
        autoClose: 10000,
      });
    }
  };

  const copyPreviewLink = async () => {
    if (!iframeUrl) {
      return;
    }

    /**
     * Copy the same-origin wrapper link (not the raw container URL) so the
     * recipient gets the first-party page that embeds the preview — the same
     * mechanism as "open in new tab". The link only stays alive while this
     * editor tab is open, since the app runs in this browser.
     */
    const shareUrl = `${window.location.origin}/preview?u=${encodeURIComponent(iframeUrl)}`;

    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success('Preview link copied! It stays live only while this tab is open.', { autoClose: 8000 });
    } catch {
      toast.error('Could not copy the link — copy it from the address bar after opening in a new tab instead.', {
        autoClose: 10000,
      });
    }
  };

  return (
    <div className="w-full h-full flex flex-col">
      {isPortDropdownOpen && (
        <div className="z-iframe-overlay w-full h-full absolute" onClick={() => setIsPortDropdownOpen(false)} />
      )}
      <div className="bg-bolt-elements-background-depth-2 p-2 flex items-center gap-1.5">
        <IconButton icon="i-ph:arrow-clockwise" title="Reload preview" onClick={reloadPreview} />
        <IconButton
          icon="i-ph:arrow-square-out"
          title="Open preview in new tab (keep this tab open)"
          disabled={!iframeUrl}
          onClick={openInNewTab}
        />
        <IconButton
          icon="i-ph:link"
          title="Copy preview link (live while this tab is open)"
          disabled={!iframeUrl}
          onClick={copyPreviewLink}
        />
        <div
          className="flex items-center gap-1 flex-grow bg-bolt-elements-preview-addressBar-background border border-bolt-elements-borderColor text-bolt-elements-preview-addressBar-text rounded-full px-3 py-1 text-sm hover:bg-bolt-elements-preview-addressBar-backgroundHover hover:focus-within:bg-bolt-elements-preview-addressBar-backgroundActive focus-within:bg-bolt-elements-preview-addressBar-backgroundActive
        focus-within-border-bolt-elements-borderColorActive focus-within:text-bolt-elements-preview-addressBar-textActive"
        >
          <input
            ref={inputRef}
            className="w-full bg-transparent outline-none"
            type="text"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && validateUrl(url)) {
                setIframeUrl(url);

                if (inputRef.current) {
                  inputRef.current.blur();
                }
              }
            }}
          />
        </div>
        {devServerStatus === 'starting' && (
          <div className="flex items-center gap-1.5 text-xs text-bolt-elements-textSecondary whitespace-nowrap px-2">
            <div className="i-svg-spinners:90-ring-with-bg text-sm" />
            Starting app…
          </div>
        )}
        {devServerStatus === 'error' && (
          <button
            className="flex items-center gap-1.5 text-xs whitespace-nowrap px-3 py-1 rounded-full bg-bolt-elements-button-danger-background text-bolt-elements-button-danger-text hover:opacity-90"
            onClick={() => devServerStore.restart()}
          >
            <div className="i-ph:arrow-clockwise text-sm" />
            Restart app
          </button>
        )}
        {previews.length > 1 && (
          <PortDropdown
            activePreviewIndex={activePreviewIndex}
            setActivePreviewIndex={setActivePreviewIndex}
            isDropdownOpen={isPortDropdownOpen}
            setHasSelectedPreview={(value) => (hasSelectedPreview.current = value)}
            setIsDropdownOpen={setIsPortDropdownOpen}
            previews={previews}
          />
        )}
      </div>
      <div className="flex-1 border-t border-bolt-elements-borderColor">
        {activePreview ? (
          <iframe
            ref={iframeRef}
            className="border-none w-full h-full bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            src={iframeUrl}
          />
        ) : (
          <div className="flex w-full h-full flex-col justify-center items-center gap-2 bg-white text-gray-500 text-sm">
            {devServerStatus === 'error' ? (
              <>
                <div>The app crashed and couldn't recover on its own.</div>
                <button
                  className="px-4 py-1.5 rounded-md bg-gray-900 text-white text-sm hover:bg-gray-700"
                  onClick={() => devServerStore.restart()}
                >
                  Restart app
                </button>
              </>
            ) : devServerStatus === 'starting' ? (
              <div className="flex items-center gap-2">
                <div className="i-svg-spinners:90-ring-with-bg text-lg" />
                Starting app…
              </div>
            ) : (
              <div>No preview available</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
