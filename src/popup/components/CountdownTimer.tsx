import React, { useState, useEffect } from 'react';

interface CountdownTimerProps {
  readonly expiresAt?: number | undefined;
  readonly expiredLabel?: string | undefined;
}

export const CountdownTimer: React.FC<CountdownTimerProps> = ({
  expiresAt,
  expiredLabel = 'Expired',
}) => {
  const [timeLeft, setTimeLeft] = useState<string>('');

  useEffect(() => {
    if (!expiresAt) {
      setTimeLeft('');
      return;
    }

    let rafId: number;
    let timeoutId: ReturnType<typeof setTimeout>;

    const updateTimer = () => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        setTimeLeft(expiredLabel);
        return;
      }

      const totalMins = Math.floor(remaining / 60000);
      if (totalMins >= 60) {
        const hours = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        setTimeLeft(`${hours}h ${mins}m`);
      } else {
        const secs = Math.floor((remaining % 60000) / 1000);
        setTimeLeft(`${totalMins}:${secs < 10 ? '0' : ''}${secs}`);
      }

      // Schedule next update in 250ms to preserve battery while maintaining high precision
      timeoutId = setTimeout(() => {
        rafId = requestAnimationFrame(updateTimer);
      }, 250);
    };

    updateTimer();

    return () => {
      clearTimeout(timeoutId);
      cancelAnimationFrame(rafId);
    };
  }, [expiresAt, expiredLabel]);

  if (!timeLeft) {return null;}

  const isExpired = timeLeft === expiredLabel;

  return (
    <span className={`expiry-badge ${isExpired ? 'expired' : ''}`}>
      {timeLeft}
    </span>
  );
};
