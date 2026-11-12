import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { initialState, type Snapshot } from '../../shared/model.js';
import { rankMatch } from '../../shared/scoring.js';

const initial = initialState();
const board = createSlice({
  name: 'board', initialState: { ...initial, standings: rankMatch(initial.match), saveError: null } as Snapshot,
  reducers: { snapshot: (_state, action: PayloadAction<Snapshot>) => action.payload },
});
export const store = configureStore({ reducer: board.reducer });
export const receiveSnapshot = board.actions.snapshot;
export type RootState = ReturnType<typeof store.getState>;
