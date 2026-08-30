import { Preview } from '../features/preview';
import { Ribbon } from '../features/ribbon';

import './app.controller';

export const App = (): JSX.Element => (
	<>
		<Preview />
		<Ribbon />
	</>
);
