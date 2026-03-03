import React from 'react';
import iconLogo from '../../assets/icons/icon.png';

interface GhostLogoProps {
    size?: number;
    className?: string;
}

const GhostLogo: React.FC<GhostLogoProps> = React.memo(({ size = 24, className = '' }) => {
    return (
        <div
            className={`ghost-logo-container ${className}`}
            style={{
                width: size,
                height: size,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative'
            }}
        >
            <img
                src={iconLogo}
                alt="GhostFill Logo"
                className="ghost-logo-img"
                width={size}
                height={size}
            />
        </div>
    );
});
GhostLogo.displayName = 'GhostLogo';

export default GhostLogo;
