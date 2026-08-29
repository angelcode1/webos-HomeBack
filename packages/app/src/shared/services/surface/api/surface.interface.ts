export type SurfaceCommitState = 'visible' | 'hidden';

export type SurfaceSnapshot = {
	requestedVisible: boolean;
	committed: SurfaceCommitState;
};
