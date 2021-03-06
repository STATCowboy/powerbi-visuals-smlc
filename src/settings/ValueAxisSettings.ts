/** Internal dependencies */
    import { VisualConstants } from '../constants';
    import AxisSettings from './AxisSettings';
    let defaults = VisualConstants.defaults;

/**
 *
 */
    export default class ValueAxisSettings extends AxisSettings {
        /** Label placement */
            public labelPlacement: string = defaults.valueAxis.labelPlacement;
        /** Axis range start */
            public start: number = defaults.valueAxis.range.start;
        /** Axis range end */
            public end: number = defaults.valueAxis.range.end;
    }