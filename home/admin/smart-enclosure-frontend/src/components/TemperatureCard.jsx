import React from 'react';
import { TemperatureValue } from './TemperatureValue';

export function TemperatureCard({ zone, temperature }) {
  return (
    <div className="flex flex-col items-center justify-center bg-black p-4 rounded-lg shadow-md w-full max-w-xs">
      <TemperatureValue value={temperature} />
      <div className="font-semibold mb-2 whitespace-nowrap overflow-hidden text-ellipsis">{zone}</div>

    </div>
  );
}
