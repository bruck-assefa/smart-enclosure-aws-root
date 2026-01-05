import React from 'react';
import { LightTimes } from "../components/LightTimes";

export function LightTimingSection({ zone, temperature }) {
  return (
    <div className="mb-8">
      <h3 className="text-lg font-semibold mb-2">Light Timing</h3>
      <LightTimes />
    </div>
  );
}
