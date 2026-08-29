import './app.controller';

import { Preview } from '../features/preview';
import { Ribbon } from '../features/ribbon';

export const App = (): JSX.Element => (
	<>
		<Ribbon />
		<Preview />
	</>
);
