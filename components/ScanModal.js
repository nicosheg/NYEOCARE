// components/ScanModal.js
import{useEffect,useRef,useState}from'react';import{createPortal}from'react-dom';import{supabase}from'../lib/supabaseClient';import{getScanState,setScanState,clearScanState}from'../lib/scanStore';import ScanModal from'./ScanModal';
