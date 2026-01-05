import React from 'react';

export function TemperatureValue({ value }) {
  return (
    <div className="text-1xl">
      {value}°F
    </div>
  );
}
