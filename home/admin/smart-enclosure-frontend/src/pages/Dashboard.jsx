import React, { useState } from "react";
import { ZoneAverages } from "../components/ZoneAverages";
import { LightTimes } from "../components/LightTimes";
import { TemperatureChart } from "../components/TemperatureChart";
import SettingsModal from "./SettingsModal";

function Dashboard() {
  const [isSettingsOpen, setSettingsOpen] = useState(false);

  const sampleData = [
    { name: "Hot Zone", temperature: 95.5 },
    { name: "Transition Zone", temperature: 85.2 },
    { name: "Cold Zone", temperature: 72.8 }
  ];

  return (
    <div className="min-h-screen w-screen flex flex-col justify-center items-center gap-4 relative px-2">
      <div className="absolute top-4 right-4 cursor-pointer" onClick={() => setSettingsOpen(true)}>
        <div className='h-8 w-8 bg-gray-600 text-white rounded-full flex items-center justify-center hover:bg-gray-800'>⚙️</div>
      </div>
      <div className="w-full max-w-xl flex justify-center">
        <ZoneAverages zones={sampleData} />
      </div>
      <div className="w-full max-w-xl flex justify-center">
        <LightTimes onTime="Sunrise (07:00)" offTime="Sunset (21:00)" />
      </div>
      <div className="w-full max-w-xl flex justify-center">
        <div className="w-full">
          <TemperatureChart />
        </div>
      </div>
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

export default Dashboard;
