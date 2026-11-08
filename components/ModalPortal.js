// components/ModalPortal.js
import { createPortal } from 'react-dom';

export default function ModalPortal({ children }) {
  if (typeof document === 'undefined') return null;

  const root = document.getElementById('nyeocare-modal-root');
  return createPortal(children, root || document.body);
}
