'use strict';


import { div, button, iconButton, h4 } from './tags.js'
import {
    BoolType,
    ByteType,
    DateType, DoubleType,
    FloatType,
    IntType,
    LongType,
    ShortType,
    StringType,
    TimestampType
} from "./data_type";
import {FakeSelect} from "./fake_select";
import {fakeSelectElem, span} from "./tags";
import {SocketSession} from "./comms";
import {GroupAgg, ModifyStream, ReleaseHandle} from "./messages";
import {Pair} from "./codec";
import {DataStream, StreamingDataRepr} from "./value_repr";
import embed from "vega-embed";


function isDimension(dataType) {
    return (
        dataType === ByteType ||
        dataType === BoolType ||
        dataType === ShortType ||
        dataType === IntType ||
        dataType === LongType ||
        dataType === StringType ||
        dataType === DateType ||
        dataType === TimestampType
    )
}

function measures(field) {
    const dataType = field.dataType;
    if (
        dataType === ByteType ||
        dataType === ShortType ||
        dataType === IntType ||
        dataType === LongType ||
        dataType === FloatType ||
        dataType === DoubleType
    ) {
        const selector = new FakeSelect(fakeSelectElem(['choose-measure'], [
            button(['selected'], {value: 'mean'}, ['Mean']),
            button([], {value: 'count'}, ['Count']),
            button([], {value: 'quartiles'}, ['Quartiles'])
        ]));

        return div(['measure', 'selected-measure'], [
            div(['choose-measure'], [
                selector.element
            ]),
            span(['measure-name'], field.name)
        ]).attr('draggable', true).withKey('field', field).withKey('selector', selector);
    } else return false;
}

function dimensionType(dataType) {
    if (dataType === StringType || dataType === BoolType) return 'nominal';
    return 'ordinal';
}

export class PlotEditor extends EventTarget {

    constructor(repr, path, name) {
        super();
        this.repr = repr;
        this.path = path;
        this.name = name;
        this.fields = repr.dataType.fields;
        this.plotTypeSelector = new FakeSelect(fakeSelectElem(['plot-type-selector'], [
            button(['selected'], {value: 'bar'}, ['Bar']),
            button([], {value: 'line'}, ['Line']),
            button([], {value: 'xy'}, ['XY Scatter']),
            button([], {value: 'boxplot'}, ['Box Plot'])
        ]));

        this.el = div(['plot-editor'], [
            div(['left-controls'], [
                this.plotTypeSelector.element,
                h4(['dimension-title'], ['Dimensions', iconButton(['add', 'add-measure'], 'Add dimension', '', 'Add').click(_ => this.showAddDimension())]),
                div(['dimension-list'], this.fields.filter(field => isDimension(field.dataType)).map(
                    field => div(['dimension'], [
                        field.name,
                        ` (${field.dataType.constructor.name(field.dataType)})`]
                    ).withKey('field', field).attr('draggable', true)
                )),
                h4(['measure-title'], ['Measures', iconButton(['add', 'add-measure'], 'Add measure', '', 'Add').click(_ => this.showAddMeasure())]),
                div(['measure-list'], this.measureSelectors = this.fields.map(field => measures(field)).filter(_ => _)),
                div(['control-buttons'], [
                    this.runButton = button(['plot'], {}, [
                        span(['fas'], ''),
                        'Plot'
                    ]).click(_ => this.runPlot())
                ])
            ]),
            this.plotArea = div(['plot-area'], [
                this.xAxisDrop = div(['x-axis-drop'], [span(['label'], ['Drop X-axis dimension here'])]),
                this.yAxisDrop = div(['y-axis-drop'], [span(['label'], ['Drop Y-axis measure(s) here'])]),
                this.plotOutput = div(['plot-output'], [
                    div(['plot-embed'], [])
                ])
            ])
        ]);

        this.plotTypeSelector.addEventListener('change', evt => this.onPlotTypeChange(evt));

        this.el.addEventListener('dragstart', evt => {
           this.draggingEl = evt.target;
        });

        this.addEventListener('dragend', evt => {
           this.xAxisDrop.classList.remove('drop-ok', 'drop-disallowed');
           this.yAxisDrop.classList.remove('drop-ok', 'drop-disallowed');
           this.draggingEl = null;
        });

        this.xAxisDrop.addEventListener('dragenter', evt => {
           if (this.draggingEl.classList.contains('dimension')) {
               this.xAxisDrop.classList.add('drop-ok');
           } else {
               this.xAxisDrop.classList.add('drop-disallowed');
           }
        });

        this.xAxisDrop.addEventListener('dragover', evt => {
            if (this.draggingEl.classList.contains('dimension')) {
                evt.preventDefault();
            }
        });

        this.xAxisDrop.addEventListener('dragleave', _ => {
           this.xAxisDrop.classList.remove('drop-ok', 'drop-disallowed');
        });

        this.xAxisDrop.addEventListener('drop', evt => {
            this.addXDimension(this.draggingEl);
            this.xAxisDrop.classList.remove('drop-ok', 'drop-disallowed');
        });

        this.yAxisDrop.addEventListener('dragenter', evt => {
            if (this.draggingEl.classList.contains('measure')) {
                this.yAxisDrop.classList.add('drop-ok');
            } else {
                this.yAxisDrop.classList.add('drop-disallowed');
            }
        });

        this.yAxisDrop.addEventListener('dragover', evt => {
            if (this.draggingEl.classList.contains('measure')) {
                evt.preventDefault();
            }
        });

        this.yAxisDrop.addEventListener('dragleave', _ => {
            this.yAxisDrop.classList.remove('drop-ok', 'drop-disallowed');
        });

        this.yAxisDrop.addEventListener('drop', evt => {
           this.addYMeasure(this.draggingEl);
            this.yAxisDrop.classList.remove('drop-ok', 'drop-disallowed');
        });

        this.session = SocketSession.current;

        this.onPlotTypeChange();
    }

    showAddMeasure() {
        // TODO - show a UI to let you explore measures you can use in more detail
    }

    showAddDimension() {
        // TODO - show a UI to let you
    }

    onPlotTypeChange(evt) {
        function showDefaultMeasures(selector) {
            selector.showAllOptions();
            selector.hideOption('quartiles');
        }

        const plotType = this.plotTypeSelector.value;
        if (specialSpecs[plotType]) {
            const specType = specialSpecs[plotType];
            if (specType.allowedAggregates) {
                this.measureSelectors.forEach(el => {
                    const sel = el.selector;
                    sel.options.forEach((opt, idx) => {
                        if (specType.allowedAggregates.indexOf(opt.value) < 0) {
                            sel.hideOption(idx);
                        } else {
                            sel.showOption(idx);
                        }
                    });
                })
            } else if (!specType.allAggregates) {
                this.measureSelectors.forEach(el => showDefaultMeasures(el.selector));
            } else {
                this.measureSelectors.forEach(el => el.selector.showAllOptions());
            }
        } else {
            this.measureSelectors.forEach(el => showDefaultMeasures(el.selector));
        }
        // TODO - evict any measures that aren't allowed by this plot type
        // TODO - allow dimension vs dimension plot if the plot type allows it
    }

    updateRepr() {
        // TODO - for multiple mods, use diff from last mod
        const ops = [];
        if (this.xDimension && this.yMeasures && this.yMeasures.length) {
            ops.push(
                new GroupAgg(
                    [this.xDimension.name],
                    this.yMeasures.map(meas => new Pair(meas.field.name, meas.agg))
                )
            );
        }

        if(ops.length) {
            return this.session.request(new ModifyStream(this.path, this.repr.handle, ops, null)).then(mod => mod.newRepr)
        }

        return Promise.as(this.repr)
    }

    addXDimension(from) {
        // TODO: multiple dimensions? Custom groupings?
        const field = from.field;
        this.xDimension = field;
        const label = this.xAxisDrop.querySelector('.label');
        label.innerHTML = '';
        label.appendChild(document.createTextNode(field.name));
    }

    addYMeasure(from) {
        if (!this.yMeasures) {
            this.yMeasures = [];
        }

        if (from.classList.contains('selected-measure')) {
            const selector = from.selector;
            const field = from.field;
            const measureConfig = {
                field,
                agg: selector.value
            };

            this.yMeasures.push(measureConfig);

            const label = span(
                ['measure'], [
                    `${selector.value}(${field.name})`,
                    iconButton(['remove'], 'Remove', '', 'X').click(_ => {
                        const idx = this.yMeasures.indexOf(measureConfig);
                        this.yMeasures.splice(idx, 1);
                        label.parentNode.removeChild(label);
                    })
                ]
            );

            const target = this.yAxisDrop.querySelector('.label');
            if (!(target.querySelector('.measure'))) {
                target.innerHTML = '';
            }
            target.appendChild(label);
        }
    }

    getSpec(plotType) {
        if(specialSpecs[plotType]) {
            const specFn = specialSpecs[plotType];
            let measures = this.yMeasures;
            if (specFn.allowedAggregates) {
                measures = measures.filter(measure => specFn.allowedAggregates.indexOf(measure.agg) >= 0);
            }
            if (!measures.length) {
                throw `No usable measures for ${plotType}`;
            }
            if (specFn.singleMeasure) {
                measures = measures[0]
            }
            return specFn.call(this, plotType, this.xDimension, measures);
        } else {
            return normalSpec.call(this, plotType, this.xDimension, this.yMeasures);
        }
    }

    runPlot() {
        //this.runButton.disabled = true;
        this.runButton.disabled = true;
        this.updateRepr().then(repr => {
            // TODO: multiple Ys
            // TODO: encode color
            // TODO: box plot has to be specially handled in order to pre-aggregate, https://github.com/vega/vega-lite/issues/4343
            const plotType = this.plotTypeSelector.value;

            const spec = this.getSpec(plotType);

            let processBatch = (batch) => batch;

            // if some measures are quantiles, we have to lift other, scalar measures to have i.e. a 'median' field
            if (spec.liftScalar) {
                const fieldName = spec.liftScalar;
                delete spec.liftScalar;

                const lifts = this.yMeasures.filter(meas => meas.agg !== 'quartiles').map(meas => `${meas.agg}(${meas.field.name})`);

                if (lifts.length !== 0) {
                    processBatch = (batch) => {
                        batch.forEach(row => {
                           lifts.forEach(field => {
                               const value = row[field];
                               row[field] = {};
                               row[field][fieldName] = value;
                           });
                        });
                        return batch;
                    }
                }
            }

            embed(
                this.plotOutput.querySelector('.plot-embed'),
                spec
            ).then(plot => {
                const stream = new DataStream(this.path, repr, this.session)
                    .batch(500)
                    .to(batch => {
                        plot.view.insert(this.name, processBatch(batch)).runAsync();
                    });
                stream.run().then(_ => {
                    plot.view.resize().runAsync();
                    this.runButton.disabled = false;
                    this.session.send(new ReleaseHandle(this.path, StreamingDataRepr.handleTypeId, repr.handle));
                });
            });

        })
    }

}

function normalSpec(plotType, xField, yMeas) {
    const spec = {
        $schema: 'https://vega.github.io/schema/vega-lite/v3.json',
        data: {name: this.name},
        mark: plotType,
        encoding: {
            x: {
                field: xField.name,
                type: dimensionType(xField.dataType)
            }
        },
        width: this.plotOutput.offsetWidth - 100,
        height: this.plotOutput.offsetHeight - 100
    };

    if (yMeas instanceof Array && yMeas.length === 1) {
        yMeas = yMeas[0];
    }

    if (yMeas instanceof Array) {
        spec.transform = [{
            fold: yMeas.map(measure => `${measure.agg}(${measure.field.name})`)
        }];
        spec.encoding.y = {
            field: 'value'
        };
        spec.encoding.color = {
            field: 'key',
            type: 'nominal'
        }
    } else {
        spec.encoding.y = {
            field: `${yMeas.agg}(${yMeas.field.name})`,
            type: 'quantitative'
        };
    }

    return spec;
}

const specialSpecs = {
    boxplot: boxplotSpec,
    line: lineSpec
};

// we kind of have to roll our own boxplot layering, because we are pre-aggregating the data (see https://github.com/vega/vega-lite/issues/4343)
// The way to construct it was taken from https://vega.github.io/vega-lite/docs/boxplot.html
// it's essentially what an actual box plot expands to.
function boxplotSpec(plotType, xField, yMeas) {
    // TODO: can we allow multiple series of boxes? Does `fold` support a struct like this?
    const yName = `quartiles(${yMeas.field.name})`;
    const x = { field: xField.name, type: dimensionType(xField.dataType) };
    const size = 14;
    return {
        $schema: 'https://vega.github.io/schema/vega-lite/v3.json',
        data: {name: this.name},
        width: this.plotOutput.offsetWidth - 100,
        height: this.plotOutput.offsetHeight - 100,
        layer: [
            {
                // lower whisker
                mark: {type: "rule", style: "boxplot-rule"},
                encoding: {
                    x,
                    y: {
                        field: `${yName}.min`,
                        type: 'quantitative',
                        axis: {title: yName}
                    },
                    y2: {
                        field: `${yName}.q1`
                    }
                }
            },
            {
                // upper whisker
                mark: {type: "rule", style: "boxplot-rule"},
                encoding: {
                    x,
                    y: {
                        field: `${yName}.q3`,
                        type: 'quantitative'
                    },
                    y2: {
                        field: `${yName}.max`
                    }
                }
            },
            {
                // box
                mark: {type: "bar", size, style: "boxplot-box"},
                encoding: {
                    x,
                    y: {
                        field: `${yName}.q1`,
                        type: 'quantitative'
                    },
                    y2: {
                        field: `${yName}.q3`
                    }
                }
            },
            {
                // median tick
                mark: {
                    color: 'white',
                    type: 'tick',
                    size,
                    orient: 'horizontal',
                    style: 'boxplot-median'
                },
                encoding: {
                    x,
                    y: {
                        field: `${yName}.median`,
                        type: 'quantitative'
                    }
                }
            },
            {
                // mean point
                mark: {
                    color: 'black',
                    type: 'point',
                    size: size / 2
                },
                encoding: {
                    x,
                    y: {
                        field: `${yName}.mean`,
                        type: 'quantitative'
                    }
                }
            }
        ]
    };
}

boxplotSpec.allowedAggregates = ['quartiles'];
boxplotSpec.singleMeasure = true;

function lineSpec(plotType, xField, yMeas) {
    if (yMeas instanceof Array && yMeas.length === 1) {
        yMeas = yMeas[0];
    }

    let yField = "";
    let transform = [];
    let encodeColor = false;
    let confidenceBands = false;
    let layer = [];

    if (yMeas instanceof Array) {
        transform = [{
            fold: yMeas.map(measure => `${measure.agg}(${measure.field.name})`)
        }];
        encodeColor = {
            field: 'key',
            type: 'nominal'
        };
        yField = 'value';

        confidenceBands = yMeas.findIndex(meas => meas.agg === 'quartiles') >= 0;
    } else {
        yField = `${yMeas.agg}(${yMeas.field.name})`;
        confidenceBands = yMeas.agg === 'quartiles';
    }

    if (confidenceBands) {
        layer = [
            // TODO: are min/max useful? Or just too much noise?
            /*{
                mark: 'area',
                encoding: {
                    x: {
                        field: xField.name,
                        type: 'ordinal'
                    },
                    y: {
                        field: `${yField}.min`,
                        type: 'quantitative',
                        //axis:  {title: yField}
                    },
                    y2: {
                        field: `${yField}.max`
                    },
                    opacity: {value: 0.1}
                },
            },*/
            {
                mark: 'area',
                encoding: {
                    x: {
                        field: xField.name,
                        type: 'ordinal'
                    },
                    y: {
                        field: `${yField}.q1`,
                        type: 'quantitative'
                    },
                    y2: {
                        field: `${yField}.q3`
                    },
                    opacity: {value: 0.3}
                },
            },
            {
                mark: 'line',
                encoding: {
                    x: {
                        field: xField.name,
                        type: 'ordinal'
                    },
                    y: {
                        field: `${yField}.median`,
                        type: 'quantitative',
                        axis: yField
                    }
                },
            }
        ];
    } else {
        layer = [
            {
                mark: 'line',
                encoding: {
                    x: {
                        field: xField.name,
                        type: 'ordinal'
                    },
                    y: {
                        field: yField,
                        type: 'quantitative'
                    }
                },
            }
        ];
    }

    if (encodeColor) {
        layer.forEach(l => l.encoding.color = encodeColor);
    }

    const spec = {
        $schema: 'https://vega.github.io/schema/vega-lite/v3.json',
        data: {name: this.name},
        width: this.plotOutput.offsetWidth - 100,
        height: this.plotOutput.offsetHeight - 100,
        transform,
        layer
    };

    if (confidenceBands) {
        spec.liftScalar = 'median';
    }

    return spec;
}

lineSpec.allAggregates = true;