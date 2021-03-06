/** Power BI API Dependencies */
    import 'core-js/stable';
    import './../style/visual.less';
    import powerbi from 'powerbi-visuals-api';
    import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
    import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
    import IVisual = powerbi.extensibility.visual.IVisual;
    import EnumerateVisualObjectInstancesOptions = powerbi.EnumerateVisualObjectInstancesOptions;
    import VisualObjectInstance = powerbi.VisualObjectInstance;
    import DataView = powerbi.DataView;
    import VisualObjectInstanceEnumerationObject = powerbi.VisualObjectInstanceEnumerationObject;
    import IVisualHost = powerbi.extensibility.visual.IVisualHost;
    import IVisualEventService = powerbi.extensibility.IVisualEventService;
    import ILocalizationManager = powerbi.extensibility.ILocalizationManager;
    import VisualUpdateType = powerbi.VisualUpdateType;
    import { createTooltipServiceWrapper } from 'powerbi-visuals-utils-tooltiputils';

/** Internal Dependencies */
    import VisualSettings from './settings/VisualSettings';
    import Debugger from './debug/Debugger';
    import ViewModelHandler from './viewModel/ViewModelHandler';
    import ChartHelper from './dom/ChartHelper';
    import { VisualConstants } from './constants';
    import { objectMigrationV1ToV2 } from './propertyMigration';
    import DataViewHelper from './dataView/DataViewHelper';
    import LandingPageHandler from './dom/LandingPageHandler';

    export class Visual implements IVisual {
        /** The root element for the entire visual */
            private visualContainer: HTMLElement;
        /** Visual host services */
            private host: IVisualHost;
        /** Parsed visual settings */
            private settings: VisualSettings;
        /** Handle rendering events */
            private events: IVisualEventService;
        /** Handle localisation of visual text */
            private localisationManager: ILocalizationManager;
        /** Keeps our view model managed */
            private viewModelHandler: ViewModelHandler;
        /** Manages drawing stuff in our visual */
            private chartHelper: ChartHelper;
        /** Handles landing page */
            private landingPageHandler: LandingPageHandler;

        /** Runs when the visual is initialised */
            constructor(options: VisualConstructorOptions) {
                this.host = options.host;
                this.visualContainer = options.element;

                try {

                    this.viewModelHandler = new ViewModelHandler(this.host);
                    this.localisationManager = this.host.createLocalizationManager();
                    this.chartHelper = new ChartHelper(this.visualContainer);
                    this.landingPageHandler = new LandingPageHandler(this.chartHelper.landingContainer, this.localisationManager);
                    this.chartHelper.host = this.host;
                    this.chartHelper.selectionManager = this.host.createSelectionManager();
                    this.chartHelper.tooltipServiceWrapper = createTooltipServiceWrapper(this.host.tooltipService, options.element);
                    this.events = this.host.eventService;
                    Debugger.log('Visual constructor ran successfully :)');

                } catch (e) {

                    /** Signal that we've encountered an error */
                        Debugger.heading('Rendering failed');
                        Debugger.log(e);

                }
            }

        /** Runs when data roles added or something changes */
            public update(options: VisualUpdateOptions) {

                /** Handle main update flow */
                    try {

                        /** Signal we've begun rendering */
                            this.events.renderingStarted(options);
                            this.chartHelper.clearChart();
                            Debugger.clear();
                            Debugger.heading('Visual update');
                            Debugger.log(`Update type: ${options.type}`);
                            Debugger.log('Edit Mode', options.editMode, options.editMode ? '(Editor On)' : '(Editor Off)');

                        /** Parse the settings for use in the visual */
                            Debugger.log('Parsing settings...');
                            this.settings = Visual.parseSettings(options && options.dataViews && options.dataViews[0], this.host);
                            this.viewModelHandler.settings = this.chartHelper.settings = this.settings;
                            Debugger.log('Settings', this.settings);
                            Debugger.footer();

                        /** Initialise view model and test */
                            switch (options.type) {
                                case VisualUpdateType.Data:
                                case VisualUpdateType.All: {
                                    Debugger.log('Data changed. We need to re-map from data view...');
                                    this.viewModelHandler.validateDataViewMapping(options);
                                    if (this.viewModelHandler.viewModel.dataViewIsValid) {
                                        this.viewModelHandler.mapDataView();
                                        this.viewModelHandler.populateLegend();
                                    }
                                    break;
                                }
                                default: {
                                    Debugger.log('No need to re-map data. Skipping over...');
                                }
                            }
                            this.chartHelper.viewModel = this.viewModelHandler.viewModel;

                        /** Test viewport */
                            if (    options.viewport.width < VisualConstants.visual.minPx
                                ||  options.viewport.height < VisualConstants.visual.minPx
                            ) {
                                Debugger.log('Visual is too small to render!');
                                this.chartHelper.renderLegend();
                                this.chartHelper.displayMinimised(this.landingPageHandler);
                                this.events.renderingFinished(options);
                                return;
                            }

                        /** If we're good to go, let's plot stuff */
                            if (this.viewModelHandler.viewModel.dataViewIsValid) {
                                Debugger.footer();
                                Debugger.log('Drawing Chart');
                                Debugger.log('Passing initial viewport...');
                                this.viewModelHandler.viewModel.initialViewport = this.viewModelHandler.viewModel.viewport = options.viewport;
                                this.chartHelper.renderLegend();
                                this.landingPageHandler.handleLandingPage(options, this.host);
                                this.viewModelHandler.calculateInitialViewport();
                                this.viewModelHandler.initialiseAxes();
                                this.viewModelHandler.resolveAxisTitles();
                                this.viewModelHandler.resolveVisualViewport();
                                this.viewModelHandler.resolveChartArea();
                                this.chartHelper.addMasterAxisContainers();
                                this.chartHelper.sizeContainer();
                                this.chartHelper.addCanvas();
                                this.chartHelper.renderMasterAxes();
                                this.chartHelper.renderSmallMultiples();
                            } else {
                                Debugger.log('View model is not valid!');
                                this.chartHelper.renderLegend();
                                this.landingPageHandler.handleLandingPage(options, this.host);
                            }

                        /** Signal that we've finished rendering */
                            this.events.renderingFinished(options);
                            Debugger.log('Finished rendering');
                            Debugger.log('View Model', this.viewModelHandler.viewModel);
                            Debugger.footer();
                            return;

                    } catch (e) {

                        /** Signal that we've encountered an error */
                            this.events.renderingFailed(options, e);
                            Debugger.heading('Rendering failed');
                            Debugger.log('View Model', this.viewModelHandler.viewModel);
                            Debugger.log(e);

                    }

            }

            private static parseSettings(dataView: DataView, host: IVisualHost): VisualSettings {

                if (!dataView) {
                    return;
                }

                let objects = dataView && dataView.metadata && dataView.metadata.objects;

                /** All Small Multiple configuration used to be underneath a single menu in 1.0. A lot of this has since been refactored
                 *  into more specific locations. However, we need to ensure that any user-defined properties are migrated across to their
                 *  correct location and removed for subsequent versions. If we don't remove them, 'reset to default' will fall back to the
                 *  'pre-migration' values and potentially confuse the end-user.
                 */
                    if (    !objects
                        ||  !objects.features
                        ||  !objects.features.objectVersion
                        ||  objects.features.objectVersion < 2
                    ) {
                        Debugger.log('v2 object schema unconfirmed. Existing v1 properties will be migrated.');
                        DataViewHelper.migrateObjectProperties(dataView, host, objectMigrationV1ToV2, 2);
                    } else {
                        Debugger.log('Object schema is already on v2. No need to set up.');
                    }

                    return VisualSettings.parse(dataView) as VisualSettings;
            }

        /**
         * This function gets called for each of the objects defined in the capabilities files and allows you to select which of the
         * objects and properties you want to expose to the users in the property pane.
         *
         */
            public enumerateObjectInstances(options: EnumerateVisualObjectInstancesOptions): powerbi.VisualObjectInstanceEnumeration {
                let instances: VisualObjectInstance[] = (
                    VisualSettings.enumerateObjectInstances(this.settings || VisualSettings.getDefault(), options) as VisualObjectInstanceEnumerationObject).instances;
                let objectName = options.objectName;

                const enumerationObject: powerbi.VisualObjectInstanceEnumerationObject = {
                    containers: [],
                    instances: [],
                };

                switch (objectName) {

                    case 'yAxis': {

                        /** Range validation */
                            instances[0].validValues = instances[0].validValues || {};
                            instances[0].validValues.precision = {
                                numberRange: {
                                    min: VisualConstants.ranges.precision.min,
                                    max: VisualConstants.ranges.precision.max
                                },
                            };
                            instances[0].validValues.gridlineStrokeWidth = {
                                numberRange: {
                                    min: VisualConstants.ranges.gridlineStrokeWidth.min,
                                    max: VisualConstants.ranges.gridlineStrokeWidth.max
                                },
                            };

                        /** Label toggle */
                            if (!this.settings.yAxis.showLabels) {
                                delete instances[0].properties['labelPlacement'];
                                delete instances[0].properties['fontColor'];
                                delete instances[0].properties['fontSize'];
                                delete instances[0].properties['fontFamily'];
                                delete instances[0].properties['labelDisplayUnits'];
                                delete instances[0].properties['precision'];
                            }

                        /** Gridline toggle */
                            if (!this.settings.yAxis.gridlines) {
                                delete instances[0].properties['gridlineColor'];
                                delete instances[0].properties['gridlineStrokeWidth'];
                                delete instances[0].properties['gridlineStrokeLineStyle'];
                            }

                        /** Title toggle */
                            if (!this.settings.yAxis.showTitle) {
                                delete instances[0].properties['titleStyle'];
                                delete instances[0].properties['titleColor'];
                                delete instances[0].properties['titleText'];
                                delete instances[0].properties['titleFontSize'];
                                delete instances[0].properties['titleFontFamily'];
                            }

                        /** Title style toggle if units are none */
                            if (this.settings.yAxis.labelDisplayUnits === 1 || !this.viewModelHandler.viewModel.yAxis.numberFormat.displayUnit) {
                                instances[0].properties['titleStyle'] = 'title';
                                instances[0].validValues.titleStyle = [
                                    'title'
                                ];
                            }

                        /** Axis placement */
                            if (!this.settings.features.axisLabelPlacement) {
                                delete instances[0].properties['labelPlacement'];
                            }

                        break;
                    }

                    case 'xAxis': {

                        /** Range validation */
                            instances[0].validValues = instances[0].validValues || {};
                            instances[0].validValues.gridlineStrokeWidth = {
                                numberRange: {
                                    min: VisualConstants.ranges.gridlineStrokeWidth.min,
                                    max: VisualConstants.ranges.gridlineStrokeWidth.max
                                },
                            };
                            instances[0].validValues.axisLineStrokeWidth = {
                                numberRange: {
                                    min: VisualConstants.ranges.axisLineStrokeWidth.min,
                                    max: VisualConstants.ranges.axisLineStrokeWidth.max
                                },
                            };

                        /** Label toggle */
                            if (!this.settings.xAxis.showLabels) {
                                delete instances[0].properties['labelPlacement'];
                                delete instances[0].properties['fontColor'];
                                delete instances[0].properties['fontSize'];
                                delete instances[0].properties['fontFamily'];
                            }

                        /** Gridline toggle */
                            if (!this.settings.xAxis.gridlines) {
                                delete instances[0].properties['gridlineColor'];
                                delete instances[0].properties['gridlineStrokeWidth'];
                                delete instances[0].properties['gridlineStrokeLineStyle'];
                            }

                        /** Title toggle */
                            if (!this.settings.xAxis.showTitle) {
                                delete instances[0].properties['titleColor'];
                                delete instances[0].properties['titleText'];
                                delete instances[0].properties['titleFontSize'];
                                delete instances[0].properties['titleFontFamily'];
                            }

                        /** Axis line toggle */
                            if (!this.settings.xAxis.showAxisLine) {
                                delete instances[0].properties['axisLineColor'];
                                delete instances[0].properties['axisLineStrokeWidth'];
                            }

                        /** Axis placement */
                            if (!this.settings.features.axisLabelPlacement) {
                                delete instances[0].properties['labelPlacement'];
                            }

                        break;
                    }

                    case 'colorSelector': {

                        /** No longer needed, as all properties have been migrated */
                            instances = [];

                        break;

                    }

                    case 'lines': {

                        /** Remove default instance, and replace with measure-based properties */
                            instances = [];
                            for (let measure of this.viewModelHandler.viewModel.measureMetadata) {
                                let displayName = measure.metadata.displayName,
                                    containerIdx = enumerationObject.containers.push({displayName: displayName}) - 1;
                                /** containerIdx doesn't work properly in the SDK yet, and there's no ETA on when it will. Until then,
                                 *  we'll use a hack by pushing an integer field without validation to create a 'heading' */
                                    if (containerIdx > 0) {
                                        instances.push({
                                            objectName: objectName,
                                            displayName: '－－－－－－－－－－',
                                            properties: {
                                                measureName: null
                                            },
                                            selector: {
                                                metadata: measure.metadata.queryName
                                            }
                                        });
                                    }
                                    instances.push({
                                        objectName: objectName,
                                        displayName: measure.metadata.displayName,
                                        properties: {
                                            measureName: null
                                        },
                                        selector: {
                                            metadata: measure.metadata.queryName
                                        }
                                    });
                                /** The main body of our measure configuration */
                                    let inst: VisualObjectInstance = {
                                        objectName: objectName,
                                        properties: {
                                            stroke: {
                                                solid: {
                                                    color: measure.stroke
                                                }
                                            },
                                            strokeWidth: measure.strokeWidth,
                                            showArea: measure.showArea,
                                            backgroundTransparency: measure.backgroundTransparency,
                                            lineShape: measure.lineShape,
                                            lineStyle: measure.lineStyle
                                        },
                                        selector: {
                                            metadata: measure.metadata.queryName
                                        },
                                        /** containerIdx: containerIdx, */
                                        validValues: {
                                            strokeWidth: {
                                                numberRange: {
                                                    min: VisualConstants.ranges.shapeStrokeWidth.min,
                                                    max: VisualConstants.ranges.shapeStrokeWidth.max
                                                }
                                            }
                                        }
                                    };
                                    if (!measure.showArea) {
                                        delete inst.properties.backgroundTransparency;
                                    }
                                    instances.push(inst);
                            }

                        break;
                    }

                    case 'legend': {

                        /** Title toggle */
                            if (!this.settings.legend.showTitle) {
                                delete instances[0].properties['titleText'];
                                delete instances[0].properties['includeRanges'];
                            }

                        break;
                    }

                    case 'layout': {

                        /** Range validation */
                            instances[0].validValues = instances[0].validValues || {};
                            instances[0].validValues.spacingBetweenColumns = {
                                numberRange: {
                                    min: VisualConstants.ranges.spacing.min,
                                    max: VisualConstants.ranges.spacing.max
                                },
                            };
                            instances[0].validValues.spacingBetweenRows = {
                                numberRange: {
                                    min: VisualConstants.ranges.spacing.min,
                                    max: VisualConstants.ranges.spacing.max
                                }
                            };
                            instances[0].validValues.numberOfColumns = {
                                numberRange: {
                                    min: VisualConstants.ranges.numberOfColumns.min,
                                    max: VisualConstants.ranges.numberOfColumns.max
                                }
                            };
                            instances[0].validValues.multipleHeight =
                            instances[0].validValues.multipleWidth = {
                                numberRange: {
                                    min: VisualConstants.ranges.multipleSize.min,
                                    max: VisualConstants.ranges.multipleSize.max
                                }
                            };

                        /** Manage flow options */
                            switch (this.settings.layout.horizontalGrid) {
                                case 'column': {
                                    /** Row spacing */
                                        if (!this.settings.layout.numberOfColumns) {
                                            delete instances[0].properties['spacingBetweenRows'];
                                        }
                                    /** No setting of width */
                                        delete instances[0].properties['multipleWidth'];
                                    break;
                                }
                                case 'width': {
                                    delete instances[0].properties['numberOfColumns'];
                                    break;
                                }
                            }
                            switch (this.settings.layout.verticalGrid) {
                                case 'fit': {
                                    /** No setting of height */
                                        delete instances[0].properties['multipleHeight'];
                                    break;
                                }
                            }
                        break;

                    }

                    case 'heading': {
                        /** Banded multiples toggle */
                        if (!this.settings.smallMultiple.zebraStripe) {
                            delete instances[0].properties['fontColourAlternate'];
                        }
                        break;
                    }

                    case 'smallMultiple': {

                        /** Conceal previously shown properties that have since been moved */
                            delete instances[0].properties['showMultipleLabel'];
                            delete instances[0].properties['spacingBetweenColumns'];
                            delete instances[0].properties['maximumMultiplesPerRow'];
                            delete instances[0].properties['spacingBetweenRows'];
                            delete instances[0].properties['labelPosition'];
                            delete instances[0].properties['labelAlignment'];
                            delete instances[0].properties['fontSize'];
                            delete instances[0].properties['fontFamily'];
                            delete instances[0].properties['fontColor'];
                            delete instances[0].properties['fontColorAlternate'];

                        /** Range validation */
                            instances[0].validValues = instances[0].validValues || {};
                            instances[0].validValues.borderStrokeWidth = {
                                numberRange: {
                                    min: VisualConstants.ranges.borderStrokeWidth.min,
                                    max: VisualConstants.ranges.borderStrokeWidth.max
                                }
                            };

                        /** Banded multiples toggle */
                            if (!this.settings.smallMultiple.zebraStripe) {
                                delete instances[0].properties['zebraStripeApply'];
                                delete instances[0].properties['backgroundColorAlternate'];
                            }

                        /** Border toggle */
                            if (!this.settings.smallMultiple.border) {
                                delete instances[0].properties['borderColor'];
                                delete instances[0].properties['borderStrokeWidth'];
                                delete instances[0].properties['borderStyle'];
                            }

                        break;
                    }

                    case 'features': {
                        if (!VisualConstants.debug) {
                            instances = [];
                        }
                        break;
                    }

                }

                enumerationObject.instances.push(...instances);
                return enumerationObject;

            }
    }