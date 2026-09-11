// components/ScanRecovery.js
import{useEffect,useState}from'react';
import{getScanState}from'../lib/scanStore';
import ScanModal from'./ScanModal';
export default function ScanRecovery(){const[open,setOpen]=useState(false);useEffect(()=>{const check=()=>{const s=getScanState();setOpen(s.stage==='processing'&&!!s.jobId)};check();window.addEventListener('nyeocare:scan-state',check);window.addEventListener('storage',check);return()=>{window.removeEventListener('nyeocare:scan-state',check);window.removeEventListener('storage',check)}},[]);return <ScanModal isOpen={open} onClose={()=>setOpen(false)}/>}
