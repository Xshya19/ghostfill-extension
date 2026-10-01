/**
 * Static SVG optics for the popup and Options page. Each shape has its own
 * displacement map so the bend hugs the visible border radius. The filter is
 * rendered once per extension document and referenced by backdrop-filter.
 *
 * Adapted from Leonard van Hemert's liquid-glass-react (MIT license).
 * See docs/third-party/liquid-glass-react-LICENSE.
 */
import React from 'react';

type LensProps = {
  id: string;
  image: string;
  scale: number;
};

function Lens({ id, image, scale }: LensProps): React.ReactElement {
  return (
    <filter id={id} colorInterpolationFilters="sRGB" x="0%" y="0%" width="100%" height="100%">
      <feImage
        href={image}
        preserveAspectRatio="none"
        x="0"
        y="0"
        width="100%"
        height="100%"
        result="shape"
      />
      <feDisplacementMap
        in="SourceGraphic"
        in2="shape"
        scale={scale}
        xChannelSelector="R"
        yChannelSelector="G"
      />
    </filter>
  );
}

export function GlassFilterDefs(): React.ReactElement {
  const asset = (name: string): string => chrome.runtime.getURL(`assets/${name}`);

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      style={{
        position: 'absolute',
        width: 0,
        height: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      <defs>
        <Lens id="gf-optic-pill" image={asset('glass-lens-pill.png')} scale={-18} />
        <Lens id="gf-optic-control" image={asset('glass-lens-control.png')} scale={-16} />
        <Lens id="gf-optic-wide" image={asset('glass-lens-wide.png')} scale={-16} />
        <Lens id="gf-optic-icon" image={asset('glass-lens-icon.png')} scale={-10} />
      </defs>
    </svg>
  );
}
