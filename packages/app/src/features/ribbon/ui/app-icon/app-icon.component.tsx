import type { ImgHTMLAttributes } from 'react';

type AppIconProps = ImgHTMLAttributes<HTMLImageElement> & {
	fallbackIcon: string;
};

export const AppIcon = ({
	fallbackIcon,
	onError,
	...props
}: AppIconProps): JSX.Element => (
	<img
		{...props}
		onError={event => {
			if (event.currentTarget.src !== fallbackIcon) {
				event.currentTarget.src = fallbackIcon;
			}
			onError?.(event);
		}}
	/>
);
