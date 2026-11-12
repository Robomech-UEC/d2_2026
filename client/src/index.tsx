import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { CssBaseline } from '@mui/material';
import { AppMuiThemeProvider } from './AppMuiThemeProvider.js';
import { store } from './store.js';
import { ConnectionProvider } from './connection.js';
import App from './App.js';
import './style.css';

const container = document.getElementById('root');
if (!container) throw new Error('root element missing');
createRoot(container).render(
  <React.StrictMode><Provider store={store}><ConnectionProvider><BrowserRouter><AppMuiThemeProvider><CssBaseline /><App /></AppMuiThemeProvider></BrowserRouter></ConnectionProvider></Provider></React.StrictMode>,
);
