import React from "react";
import { SensorsSection } from "../components/SensorsSection";
import { LightTimingSection } from "../components/LightTimingSection";

function SettingsModal({ isOpen, onClose }) {
  return (
    <div className={`fixed px-5 inset-0 z-50 flex items-center justify-center bg-transparent backdrop-blur-md ${isOpen ? 'block' : 'hidden'}`}>
      <div className="pl-6 pr-6 rounded-lg shadow-lg w-200 border border-gray-300 rounded overflow-y-auto scrollbar-none max-h-[80vh]">
        <div className="flex justify-between">
          <div className="text-3xl mt-5 mb-3 font-bold">Settings</div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-xl p-0 m-0 bg-transparent border-none focus:outline-none" aria-label="Close settings modal">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <SensorsSection />
        <LightTimingSection />

      </div>
    </div>
  );
}


export default SettingsModal;



