(function(global) {
// CodeMirror version 3.15
//
// CodeMirror is the only global var we claim
    var CodeMirror = (function() {
        "use strict";

        // BROWSER SNIFFING

        // Crude, but necessary to handle a number of hard-to-feature-detect
        // bugs and behavior differences.
        var gecko = /gecko\/\d/i.test(navigator.userAgent);
        var ie = /MSIE \d/.test(navigator.userAgent);
        var ie_lt8 = ie && (document.documentMode == null || document.documentMode < 8);
        var ie_lt9 = ie && (document.documentMode == null || document.documentMode < 9);
        var webkit = /WebKit\//.test(navigator.userAgent);
        var qtwebkit = webkit && /Qt\/\d+\.\d+/.test(navigator.userAgent);
        var chrome = /Chrome\//.test(navigator.userAgent);
        var opera = /Opera\//.test(navigator.userAgent);
        var safari = /Apple Computer/.test(navigator.vendor);
        var khtml = /KHTML\//.test(navigator.userAgent);
        var mac_geLion = /Mac OS X 1\d\D([7-9]|\d\d)\D/.test(navigator.userAgent);
        var mac_geMountainLion = /Mac OS X 1\d\D([8-9]|\d\d)\D/.test(navigator.userAgent);
        var phantom = /PhantomJS/.test(navigator.userAgent);

        var ios = /AppleWebKit/.test(navigator.userAgent) && /Mobile\/\w+/.test(navigator.userAgent);
        // This is woefully incomplete. Suggestions for alternative methods welcome.
        var mobile = ios || /Android|webOS|BlackBerry|Opera Mini|Opera Mobi|IEMobile/i.test(navigator.userAgent);
        var mac = ios || /Mac/.test(navigator.platform);
        var windows = /windows/i.test(navigator.platform);

        var opera_version = opera && navigator.userAgent.match(/Version\/(\d*\.\d*)/);
        if (opera_version) opera_version = Number(opera_version[1]);
        if (opera_version && opera_version >= 15) { opera = false; webkit = true; }
        // Some browsers use the wrong event properties to signal cmd/ctrl on OS X
        var flipCtrlCmd = mac && (qtwebkit || opera && (opera_version == null || opera_version < 12.11));
        var captureMiddleClick = gecko || (ie && !ie_lt9);

        // Optimize some code when these features are not used
        var sawReadOnlySpans = false, sawCollapsedSpans = false;

        // CONSTRUCTOR

        function CodeMirror(place, options) {
            if (!(this instanceof CodeMirror)) return new CodeMirror(place, options);

            this.options = options = options || {};
            // Determine effective options based on given values and defaults.
            for (var opt in defaults) if (!options.hasOwnProperty(opt) && defaults.hasOwnProperty(opt))
                options[opt] = defaults[opt];
            setGuttersForLineNumbers(options);

            var docStart = typeof options.value == "string" ? 0 : options.value.first;
            var display = this.display = makeDisplay(place, docStart);
            display.wrapper.CodeMirror = this;
            updateGutters(this);
            if (options.autofocus && !mobile) focusInput(this);

            this.state = {keyMaps: [],
                overlays: [],
                modeGen: 0,
                overwrite: false, focused: false,
                suppressEdits: false, pasteIncoming: false,
                draggingText: false,
                highlight: new Delayed()};

            themeChanged(this);
            if (options.lineWrapping)
                this.display.wrapper.className += " CodeMirror-wrap";

            var doc = options.value;
            if (typeof doc == "string") doc = new Doc(options.value, options.mode);
            operation(this, attachDoc)(this, doc);

            // Override magic textarea content restore that IE sometimes does
            // on our hidden textarea on reload
            if (ie) setTimeout(bind(resetInput, this, true), 20);

            registerEventHandlers(this);
            // IE throws unspecified error in certain cases, when
            // trying to access activeElement before onload
            var hasFocus; try { hasFocus = (document.activeElement == display.input); } catch(e) { }
            if (hasFocus || (options.autofocus && !mobile)) setTimeout(bind(onFocus, this), 20);
            else onBlur(this);

            operation(this, function() {
                for (var opt in optionHandlers)
                    if (optionHandlers.propertyIsEnumerable(opt))
                        optionHandlers[opt](this, options[opt], Init);
                for (var i = 0; i < initHooks.length; ++i) initHooks[i](this);
            })();
        }

        // DISPLAY CONSTRUCTOR

        function makeDisplay(place, docStart) {
            var d = {};

            var input = d.input = elt("textarea", null, null, "position: absolute; padding: 0; width: 1px; height: 1em; outline: none; font-size: 4px;");
            if (webkit) input.style.width = "1000px";
            else input.setAttribute("wrap", "off");
            // if border: 0; -- iOS fails to open keyboard (issue #1287)
            if (ios) input.style.border = "1px solid black";
            input.setAttribute("autocorrect", "off"); input.setAttribute("autocapitalize", "off"); input.setAttribute("spellcheck", "false");

            // Wraps and hides input textarea
            d.inputDiv = elt("div", [input], null, "overflow: hidden; position: relative; width: 3px; height: 0px;");
            // The actual fake scrollbars.
            d.scrollbarH = elt("div", [elt("div", null, null, "height: 1px")], "CodeMirror-hscrollbar");
            d.scrollbarV = elt("div", [elt("div", null, null, "width: 1px")], "CodeMirror-vscrollbar");
            d.scrollbarFiller = elt("div", null, "CodeMirror-scrollbar-filler");
            d.gutterFiller = elt("div", null, "CodeMirror-gutter-filler");
            // DIVs containing the selection and the actual code
            d.lineDiv = elt("div", null, "CodeMirror-code");
            d.selectionDiv = elt("div", null, null, "position: relative; z-index: 1");
            // Blinky cursor, and element used to ensure cursor fits at the end of a line
            d.cursor = elt("div", "\u00a0", "CodeMirror-cursor");
            // Secondary cursor, shown when on a 'jump' in bi-directional text
            d.otherCursor = elt("div", "\u00a0", "CodeMirror-cursor CodeMirror-secondarycursor");
            // Used to measure text size
            d.measure = elt("div", null, "CodeMirror-measure");
            // Wraps everything that needs to exist inside the vertically-padded coordinate system
            d.lineSpace = elt("div", [d.measure, d.selectionDiv, d.lineDiv, d.cursor, d.otherCursor],
                null, "position: relative; outline: none");
            // Moved around its parent to cover visible view
            d.mover = elt("div", [elt("div", [d.lineSpace], "CodeMirror-lines")], null, "position: relative");
            // Set to the height of the text, causes scrolling
            d.sizer = elt("div", [d.mover], "CodeMirror-sizer");
            // D is needed because behavior of elts with overflow: auto and padding is inconsistent across browsers
            d.heightForcer = elt("div", null, null, "position: absolute; height: " + scrollerCutOff + "px; width: 1px;");
            // Will contain the gutters, if any
            d.gutters = elt("div", null, "CodeMirror-gutters");
            d.lineGutter = null;
            // Provides scrolling
            d.scroller = elt("div", [d.sizer, d.heightForcer, d.gutters], "CodeMirror-scroll");
            d.scroller.setAttribute("tabIndex", "-1");
            // The element in which the editor lives.
            d.wrapper = elt("div", [d.inputDiv, d.scrollbarH, d.scrollbarV,
                d.scrollbarFiller, d.gutterFiller, d.scroller], "CodeMirror");
            // Work around IE7 z-index bug
            if (ie_lt8) { d.gutters.style.zIndex = -1; d.scroller.style.paddingRight = 0; }
            if (place.appendChild) place.appendChild(d.wrapper); else place(d.wrapper);

            // Needed to hide big blue blinking cursor on Mobile Safari
            if (ios) input.style.width = "0px";
            if (!webkit) d.scroller.draggable = true;
            // Needed to handle Tab key in KHTML
            if (khtml) { d.inputDiv.style.height = "1px"; d.inputDiv.style.position = "absolute"; }
            // Need to set a minimum width to see the scrollbar on IE7 (but must not set it on IE8).
            else if (ie_lt8) d.scrollbarH.style.minWidth = d.scrollbarV.style.minWidth = "18px";

            // Current visible range (may be bigger than the view window).
            d.viewOffset = d.lastSizeC = 0;
            d.showingFrom = d.showingTo = docStart;

            // Used to only resize the line number gutter when necessary (when
            // the amount of lines crosses a boundary that makes its width change)
            d.lineNumWidth = d.lineNumInnerWidth = d.lineNumChars = null;
            // See readInput and resetInput
            d.prevInput = "";
            // Set to true when a non-horizontal-scrolling widget is added. As
            // an optimization, widget aligning is skipped when d is false.
            d.alignWidgets = false;
            // Flag that indicates whether we currently expect input to appear
            // (after some event like 'keypress' or 'input') and are polling
            // intensively.
            d.pollingFast = false;
            // Self-resetting timeout for the poller
            d.poll = new Delayed();

            d.cachedCharWidth = d.cachedTextHeight = null;
            d.measureLineCache = [];
            d.measureLineCachePos = 0;

            // Tracks when resetInput has punted to just putting a short
            // string instead of the (large) selection.
            d.inaccurateSelection = false;

            // Tracks the maximum line length so that the horizontal scrollbar
            // can be kept static when scrolling.
            d.maxLine = null;
            d.maxLineLength = 0;
            d.maxLineChanged = false;

            // Used for measuring wheel scrolling granularity
            d.wheelDX = d.wheelDY = d.wheelStartX = d.wheelStartY = null;

            return d;
        }

        // STATE UPDATES

        // Used to get the editor into a consistent state again when options change.

        function loadMode(cm) {
            cm.doc.mode = CodeMirror.getMode(cm.options, cm.doc.modeOption);
            cm.doc.iter(function(line) {
                if (line.stateAfter) line.stateAfter = null;
                if (line.styles) line.styles = null;
            });
            cm.doc.frontier = cm.doc.first;
            startWorker(cm, 100);
            cm.state.modeGen++;
            if (cm.curOp) regChange(cm);
        }

        function wrappingChanged(cm) {
            if (cm.options.lineWrapping) {
                cm.display.wrapper.className += " CodeMirror-wrap";
                cm.display.sizer.style.minWidth = "";
            } else {
                cm.display.wrapper.className = cm.display.wrapper.className.replace(" CodeMirror-wrap", "");
                computeMaxLength(cm);
            }
            estimateLineHeights(cm);
            regChange(cm);
            clearCaches(cm);
            setTimeout(function(){updateScrollbars(cm);}, 100);
        }

        function estimateHeight(cm) {
            var th = textHeight(cm.display), wrapping = cm.options.lineWrapping;
            var perLine = wrapping && Math.max(5, cm.display.scroller.clientWidth / charWidth(cm.display) - 3);
            return function(line) {
                if (lineIsHidden(cm.doc, line))
                    return 0;
                else if (wrapping)
                    return (Math.ceil(line.text.length / perLine) || 1) * th;
                else
                    return th;
            };
        }

        function estimateLineHeights(cm) {
            var doc = cm.doc, est = estimateHeight(cm);
            doc.iter(function(line) {
                var estHeight = est(line);
                if (estHeight != line.height) updateLineHeight(line, estHeight);
            });
        }

        function keyMapChanged(cm) {
            var map = keyMap[cm.options.keyMap], style = map.style;
            cm.display.wrapper.className = cm.display.wrapper.className.replace(/\s*cm-keymap-\S+/g, "") +
            (style ? " cm-keymap-" + style : "");
            cm.state.disableInput = map.disableInput;
        }

        function themeChanged(cm) {
            cm.display.wrapper.className = cm.display.wrapper.className.replace(/\s*cm-s-\S+/g, "") +
            cm.options.theme.replace(/(^|\s)\s*/g, " cm-s-");
            clearCaches(cm);
        }

        function guttersChanged(cm) {
            updateGutters(cm);
            regChange(cm);
            setTimeout(function(){alignHorizontally(cm);}, 20);
        }

        function updateGutters(cm) {
            var gutters = cm.display.gutters, specs = cm.options.gutters;
            removeChildren(gutters);
            for (var i = 0; i < specs.length; ++i) {
                var gutterClass = specs[i];
                var gElt = gutters.appendChild(elt("div", null, "CodeMirror-gutter " + gutterClass));
                if (gutterClass == "CodeMirror-linenumbers") {
                    cm.display.lineGutter = gElt;
                    gElt.style.width = (cm.display.lineNumWidth || 1) + "px";
                }
            }
            gutters.style.display = i ? "" : "none";
        }

        function lineLength(doc, line) {
            if (line.height == 0) return 0;
            var len = line.text.length, merged, cur = line;
            while (merged = collapsedSpanAtStart(cur)) {
                var found = merged.find();
                cur = getLine(doc, found.from.line);
                len += found.from.ch - found.to.ch;
            }
            cur = line;
            while (merged = collapsedSpanAtEnd(cur)) {
                var found = merged.find();
                len -= cur.text.length - found.from.ch;
                cur = getLine(doc, found.to.line);
                len += cur.text.length - found.to.ch;
            }
            return len;
        }

        function computeMaxLength(cm) {
            var d = cm.display, doc = cm.doc;
            d.maxLine = getLine(doc, doc.first);
            d.maxLineLength = lineLength(doc, d.maxLine);
            d.maxLineChanged = true;
            doc.iter(function(line) {
                var len = lineLength(doc, line);
                if (len > d.maxLineLength) {
                    d.maxLineLength = len;
                    d.maxLine = line;
                }
            });
        }

        // Make sure the gutters options contains the element
        // "CodeMirror-linenumbers" when the lineNumbers option is true.
        function setGuttersForLineNumbers(options) {
            var found = false;
            for (var i = 0; i < options.gutters.length; ++i) {
                if (options.gutters[i] == "CodeMirror-linenumbers") {
                    if (options.lineNumbers) found = true;
                    else options.gutters.splice(i--, 1);
                }
            }
            if (!found && options.lineNumbers)
                options.gutters.push("CodeMirror-linenumbers");
        }

        // SCROLLBARS

        // Re-synchronize the fake scrollbars with the actual size of the
        // content. Optionally force a scrollTop.
        function updateScrollbars(cm) {
            var d = cm.display, docHeight = cm.doc.height;
            var totalHeight = docHeight + paddingVert(d);
            d.sizer.style.minHeight = d.heightForcer.style.top = totalHeight + "px";
            d.gutters.style.height = Math.max(totalHeight, d.scroller.clientHeight - scrollerCutOff) + "px";
            var scrollHeight = Math.max(totalHeight, d.scroller.scrollHeight);
            var needsH = d.scroller.scrollWidth > (d.scroller.clientWidth + 1);
            var needsV = scrollHeight > (d.scroller.clientHeight + 1);
            if (needsV) {
                d.scrollbarV.style.display = "block";
                d.scrollbarV.style.bottom = needsH ? scrollbarWidth(d.measure) + "px" : "0";
                d.scrollbarV.firstChild.style.height =
                    (scrollHeight - d.scroller.clientHeight + d.scrollbarV.clientHeight) + "px";
            } else d.scrollbarV.style.display = "";
            if (needsH) {
                d.scrollbarH.style.display = "block";
                d.scrollbarH.style.right = needsV ? scrollbarWidth(d.measure) + "px" : "0";
                d.scrollbarH.firstChild.style.width =
                    (d.scroller.scrollWidth - d.scroller.clientWidth + d.scrollbarH.clientWidth) + "px";
            } else d.scrollbarH.style.display = "";
            if (needsH && needsV) {
                d.scrollbarFiller.style.display = "block";
                d.scrollbarFiller.style.height = d.scrollbarFiller.style.width = scrollbarWidth(d.measure) + "px";
            } else d.scrollbarFiller.style.display = "";
            if (needsH && cm.options.coverGutterNextToScrollbar && cm.options.fixedGutter) {
                d.gutterFiller.style.display = "block";
                d.gutterFiller.style.height = scrollbarWidth(d.measure) + "px";
                d.gutterFiller.style.width = d.gutters.offsetWidth + "px";
            } else d.gutterFiller.style.display = "";

            if (mac_geLion && scrollbarWidth(d.measure) === 0)
                d.scrollbarV.style.minWidth = d.scrollbarH.style.minHeight = mac_geMountainLion ? "18px" : "12px";
        }

        function visibleLines(display, doc, viewPort) {
            var top = display.scroller.scrollTop, height = display.wrapper.clientHeight;
            if (typeof viewPort == "number") top = viewPort;
            else if (viewPort) {top = viewPort.top; height = viewPort.bottom - viewPort.top;}
            top = Math.floor(top - paddingTop(display));
            var bottom = Math.ceil(top + height);
            return {from: lineAtHeight(doc, top), to: lineAtHeight(doc, bottom)};
        }

        // LINE NUMBERS

        function alignHorizontally(cm) {
            var display = cm.display;
            if (!display.alignWidgets && (!display.gutters.firstChild || !cm.options.fixedGutter)) return;
            var comp = compensateForHScroll(display) - display.scroller.scrollLeft + cm.doc.scrollLeft;
            var gutterW = display.gutters.offsetWidth, l = comp + "px";
            for (var n = display.lineDiv.firstChild; n; n = n.nextSibling) if (n.alignable) {
                for (var i = 0, a = n.alignable; i < a.length; ++i) a[i].style.left = l;
            }
            if (cm.options.fixedGutter)
                display.gutters.style.left = (comp + gutterW) + "px";
        }

        function maybeUpdateLineNumberWidth(cm) {
            if (!cm.options.lineNumbers) return false;
            var doc = cm.doc, last = lineNumberFor(cm.options, doc.first + doc.size - 1), display = cm.display;
            if (last.length != display.lineNumChars) {
                var test = display.measure.appendChild(elt("div", [elt("div", last)],
                    "CodeMirror-linenumber CodeMirror-gutter-elt"));
                var innerW = test.firstChild.offsetWidth, padding = test.offsetWidth - innerW;
                display.lineGutter.style.width = "";
                display.lineNumInnerWidth = Math.max(innerW, display.lineGutter.offsetWidth - padding);
                display.lineNumWidth = display.lineNumInnerWidth + padding;
                display.lineNumChars = display.lineNumInnerWidth ? last.length : -1;
                display.lineGutter.style.width = display.lineNumWidth + "px";
                return true;
            }
            return false;
        }

        function lineNumberFor(options, i) {
            return String(options.lineNumberFormatter(i + options.firstLineNumber));
        }
        function compensateForHScroll(display) {
            return getRect(display.scroller).left - getRect(display.sizer).left;
        }

        // DISPLAY DRAWING

        function updateDisplay(cm, changes, viewPort, forced) {
            var oldFrom = cm.display.showingFrom, oldTo = cm.display.showingTo, updated;
            var visible = visibleLines(cm.display, cm.doc, viewPort);
            for (;;) {
                if (!updateDisplayInner(cm, changes, visible, forced)) break;
                forced = false;
                updated = true;
                updateSelection(cm);
                updateScrollbars(cm);

                // Clip forced viewport to actual scrollable area
                if (viewPort)
                    viewPort = Math.min(cm.display.scroller.scrollHeight - cm.display.scroller.clientHeight,
                        typeof viewPort == "number" ? viewPort : viewPort.top);
                visible = visibleLines(cm.display, cm.doc, viewPort);
                if (visible.from >= cm.display.showingFrom && visible.to <= cm.display.showingTo)
                    break;
                changes = [];
            }

            if (updated) {
                signalLater(cm, "update", cm);
                if (cm.display.showingFrom != oldFrom || cm.display.showingTo != oldTo)
                    signalLater(cm, "viewportChange", cm, cm.display.showingFrom, cm.display.showingTo);
            }
            return updated;
        }

        // Uses a set of changes plus the current scroll position to
        // determine which DOM updates have to be made, and makes the
        // updates.
        function updateDisplayInner(cm, changes, visible, forced) {
            var display = cm.display, doc = cm.doc;
            if (!display.wrapper.clientWidth) {
                display.showingFrom = display.showingTo = doc.first;
                display.viewOffset = 0;
                return;
            }

            // Bail out if the visible area is already rendered and nothing changed.
            if (!forced && changes.length == 0 &&
                visible.from > display.showingFrom && visible.to < display.showingTo)
                return;

            if (maybeUpdateLineNumberWidth(cm))
                changes = [{from: doc.first, to: doc.first + doc.size}];
            var gutterW = display.sizer.style.marginLeft = display.gutters.offsetWidth + "px";
            display.scrollbarH.style.left = cm.options.fixedGutter ? gutterW : "0";

            // Used to determine which lines need their line numbers updated
            var positionsChangedFrom = Infinity;
            if (cm.options.lineNumbers)
                for (var i = 0; i < changes.length; ++i)
                    if (changes[i].diff) { positionsChangedFrom = changes[i].from; break; }

            var end = doc.first + doc.size;
            var from = Math.max(visible.from - cm.options.viewportMargin, doc.first);
            var to = Math.min(end, visible.to + cm.options.viewportMargin);
            if (display.showingFrom < from && from - display.showingFrom < 20) from = Math.max(doc.first, display.showingFrom);
            if (display.showingTo > to && display.showingTo - to < 20) to = Math.min(end, display.showingTo);
            if (sawCollapsedSpans) {
                from = lineNo(visualLine(doc, getLine(doc, from)));
                while (to < end && lineIsHidden(doc, getLine(doc, to))) ++to;
            }

            // Create a range of theoretically intact lines, and punch holes
            // in that using the change info.
            var intact = [{from: Math.max(display.showingFrom, doc.first),
                to: Math.min(display.showingTo, end)}];
            if (intact[0].from >= intact[0].to) intact = [];
            else intact = computeIntact(intact, changes);
            // When merged lines are present, we might have to reduce the
            // intact ranges because changes in continued fragments of the
            // intact lines do require the lines to be redrawn.
            if (sawCollapsedSpans)
                for (var i = 0; i < intact.length; ++i) {
                    var range = intact[i], merged;
                    while (merged = collapsedSpanAtEnd(getLine(doc, range.to - 1))) {
                        var newTo = merged.find().from.line;
                        if (newTo > range.from) range.to = newTo;
                        else { intact.splice(i--, 1); break; }
                    }
                }

            // Clip off the parts that won't be visible
            var intactLines = 0;
            for (var i = 0; i < intact.length; ++i) {
                var range = intact[i];
                if (range.from < from) range.from = from;
                if (range.to > to) range.to = to;
                if (range.from >= range.to) intact.splice(i--, 1);
                else intactLines += range.to - range.from;
            }
            if (!forced && intactLines == to - from && from == display.showingFrom && to == display.showingTo) {
                updateViewOffset(cm);
                return;
            }
            intact.sort(function(a, b) {return a.from - b.from;});

            // Avoid crashing on IE's "unspecified error" when in iframes
            try {
                var focused = document.activeElement;
            } catch(e) {}
            if (intactLines < (to - from) * .7) display.lineDiv.style.display = "none";
            patchDisplay(cm, from, to, intact, positionsChangedFrom);
            display.lineDiv.style.display = "";
            if (focused && document.activeElement != focused && focused.offsetHeight) focused.focus();

            var different = from != display.showingFrom || to != display.showingTo ||
                display.lastSizeC != display.wrapper.clientHeight;
            // This is just a bogus formula that detects when the editor is
            // resized or the font size changes.
            if (different) {
                display.lastSizeC = display.wrapper.clientHeight;
                startWorker(cm, 400);
            }
            display.showingFrom = from; display.showingTo = to;

            updateHeightsInViewport(cm);
            updateViewOffset(cm);

            return true;
        }

        function updateHeightsInViewport(cm) {
            var display = cm.display;
            var prevBottom = display.lineDiv.offsetTop;
            for (var node = display.lineDiv.firstChild, height; node; node = node.nextSibling) if (node.lineObj) {
                if (ie_lt8) {
                    var bot = node.offsetTop + node.offsetHeight;
                    height = bot - prevBottom;
                    prevBottom = bot;
                } else {
                    var box = getRect(node);
                    height = box.bottom - box.top;
                }
                var diff = node.lineObj.height - height;
                if (height < 2) height = textHeight(display);
                if (diff > .001 || diff < -.001) {
                    updateLineHeight(node.lineObj, height);
                    var widgets = node.lineObj.widgets;
                    if (widgets) for (var i = 0; i < widgets.length; ++i)
                        widgets[i].height = widgets[i].node.offsetHeight;
                }
            }
        }

        function updateViewOffset(cm) {
            var off = cm.display.viewOffset = heightAtLine(cm, getLine(cm.doc, cm.display.showingFrom));
            // Position the mover div to align with the current virtual scroll position
            cm.display.mover.style.top = off + "px";
        }

        function computeIntact(intact, changes) {
            for (var i = 0, l = changes.length || 0; i < l; ++i) {
                var change = changes[i], intact2 = [], diff = change.diff || 0;
                for (var j = 0, l2 = intact.length; j < l2; ++j) {
                    var range = intact[j];
                    if (change.to <= range.from && change.diff) {
                        intact2.push({from: range.from + diff, to: range.to + diff});
                    } else if (change.to <= range.from || change.from >= range.to) {
                        intact2.push(range);
                    } else {
                        if (change.from > range.from)
                            intact2.push({from: range.from, to: change.from});
                        if (change.to < range.to)
                            intact2.push({from: change.to + diff, to: range.to + diff});
                    }
                }
                intact = intact2;
            }
            return intact;
        }

        function getDimensions(cm) {
            var d = cm.display, left = {}, width = {};
            for (var n = d.gutters.firstChild, i = 0; n; n = n.nextSibling, ++i) {
                left[cm.options.gutters[i]] = n.offsetLeft;
                width[cm.options.gutters[i]] = n.offsetWidth;
            }
            return {fixedPos: compensateForHScroll(d),
                gutterTotalWidth: d.gutters.offsetWidth,
                gutterLeft: left,
                gutterWidth: width,
                wrapperWidth: d.wrapper.clientWidth};
        }

        function patchDisplay(cm, from, to, intact, updateNumbersFrom) {
            var dims = getDimensions(cm);
            var display = cm.display, lineNumbers = cm.options.lineNumbers;
            if (!intact.length && (!webkit || !cm.display.currentWheelTarget))
                removeChildren(display.lineDiv);
            var container = display.lineDiv, cur = container.firstChild;

            function rm(node) {
                var next = node.nextSibling;
                if (webkit && mac && cm.display.currentWheelTarget == node) {
                    node.style.display = "none";
                    node.lineObj = null;
                } else {
                    node.parentNode.removeChild(node);
                }
                return next;
            }

            var nextIntact = intact.shift(), lineN = from;
            cm.doc.iter(from, to, function(line) {
                if (nextIntact && nextIntact.to == lineN) nextIntact = intact.shift();
                if (lineIsHidden(cm.doc, line)) {
                    if (line.height != 0) updateLineHeight(line, 0);
                    if (line.widgets && cur.previousSibling) for (var i = 0; i < line.widgets.length; ++i) {
                        var w = line.widgets[i];
                        if (w.showIfHidden) {
                            var prev = cur.previousSibling;
                            if (/pre/i.test(prev.nodeName)) {
                                var wrap = elt("div", null, null, "position: relative");
                                prev.parentNode.replaceChild(wrap, prev);
                                wrap.appendChild(prev);
                                prev = wrap;
                            }
                            var wnode = prev.appendChild(elt("div", [w.node], "CodeMirror-linewidget"));
                            if (!w.handleMouseEvents) wnode.ignoreEvents = true;
                            positionLineWidget(w, wnode, prev, dims);
                        }
                    }
                } else if (nextIntact && nextIntact.from <= lineN && nextIntact.to > lineN) {
                    // This line is intact. Skip to the actual node. Update its
                    // line number if needed.
                    while (cur.lineObj != line) cur = rm(cur);
                    if (lineNumbers && updateNumbersFrom <= lineN && cur.lineNumber)
                        setTextContent(cur.lineNumber, lineNumberFor(cm.options, lineN));
                    cur = cur.nextSibling;
                } else {
                    // For lines with widgets, make an attempt to find and reuse
                    // the existing element, so that widgets aren't needlessly
                    // removed and re-inserted into the dom
                    if (line.widgets) for (var j = 0, search = cur, reuse; search && j < 20; ++j, search = search.nextSibling)
                        if (search.lineObj == line && /div/i.test(search.nodeName)) { reuse = search; break; }
                    // This line needs to be generated.
                    var lineNode = buildLineElement(cm, line, lineN, dims, reuse);
                    if (lineNode != reuse) {
                        container.insertBefore(lineNode, cur);
                    } else {
                        while (cur != reuse) cur = rm(cur);
                        cur = cur.nextSibling;
                    }

                    lineNode.lineObj = line;
                }
                ++lineN;
            });
            while (cur) cur = rm(cur);
        }

        function buildLineElement(cm, line, lineNo, dims, reuse) {
            var lineElement = lineContent(cm, line);
            var markers = line.gutterMarkers, display = cm.display, wrap;

            if (!cm.options.lineNumbers && !markers && !line.bgClass && !line.wrapClass && !line.widgets)
                return lineElement;

            // Lines with gutter elements, widgets or a background class need
            // to be wrapped again, and have the extra elements added to the
            // wrapper div

            if (reuse) {
                reuse.alignable = null;
                var isOk = true, widgetsSeen = 0, insertBefore = null;
                for (var n = reuse.firstChild, next; n; n = next) {
                    next = n.nextSibling;
                    if (!/\bCodeMirror-linewidget\b/.test(n.className)) {
                        reuse.removeChild(n);
                    } else {
                        for (var i = 0; i < line.widgets.length; ++i) {
                            var widget = line.widgets[i];
                            if (widget.node == n.firstChild) {
                                if (!widget.above && !insertBefore) insertBefore = n;
                                positionLineWidget(widget, n, reuse, dims);
                                ++widgetsSeen;
                                break;
                            }
                        }
                        if (i == line.widgets.length) { isOk = false; break; }
                    }
                }
                reuse.insertBefore(lineElement, insertBefore);
                if (isOk && widgetsSeen == line.widgets.length) {
                    wrap = reuse;
                    reuse.className = line.wrapClass || "";
                }
            }
            if (!wrap) {
                wrap = elt("div", null, line.wrapClass, "position: relative");
                wrap.appendChild(lineElement);
            }
            // Kludge to make sure the styled element lies behind the selection (by z-index)
            if (line.bgClass)
                wrap.insertBefore(elt("div", null, line.bgClass + " CodeMirror-linebackground"), wrap.firstChild);
            if (cm.options.lineNumbers || markers) {
                var gutterWrap = wrap.insertBefore(elt("div", null, null, "position: absolute; left: " +
                    (cm.options.fixedGutter ? dims.fixedPos : -dims.gutterTotalWidth) + "px"),
                    wrap.firstChild);
                if (cm.options.fixedGutter) (wrap.alignable || (wrap.alignable = [])).push(gutterWrap);
                if (cm.options.lineNumbers && (!markers || !markers["CodeMirror-linenumbers"]))
                    wrap.lineNumber = gutterWrap.appendChild(
                        elt("div", lineNumberFor(cm.options, lineNo),
                            "CodeMirror-linenumber CodeMirror-gutter-elt",
                            "left: " + dims.gutterLeft["CodeMirror-linenumbers"] + "px; width: "
                            + display.lineNumInnerWidth + "px"));
                if (markers)
                    for (var k = 0; k < cm.options.gutters.length; ++k) {
                        var id = cm.options.gutters[k], found = markers.hasOwnProperty(id) && markers[id];
                        if (found)
                            gutterWrap.appendChild(elt("div", [found], "CodeMirror-gutter-elt", "left: " +
                            dims.gutterLeft[id] + "px; width: " + dims.gutterWidth[id] + "px"));
                    }
            }
            if (ie_lt8) wrap.style.zIndex = 2;
            if (line.widgets && wrap != reuse) for (var i = 0, ws = line.widgets; i < ws.length; ++i) {
                var widget = ws[i], node = elt("div", [widget.node], "CodeMirror-linewidget");
                if (!widget.handleMouseEvents) node.ignoreEvents = true;
                positionLineWidget(widget, node, wrap, dims);
                if (widget.above)
                    wrap.insertBefore(node, cm.options.lineNumbers && line.height != 0 ? gutterWrap : lineElement);
                else
                    wrap.appendChild(node);
                signalLater(widget, "redraw");
            }
            return wrap;
        }

        function positionLineWidget(widget, node, wrap, dims) {
            if (widget.noHScroll) {
                (wrap.alignable || (wrap.alignable = [])).push(node);
                var width = dims.wrapperWidth;
                node.style.left = dims.fixedPos + "px";
                if (!widget.coverGutter) {
                    width -= dims.gutterTotalWidth;
                    node.style.paddingLeft = dims.gutterTotalWidth + "px";
                }
                node.style.width = width + "px";
            }
            if (widget.coverGutter) {
                node.style.zIndex = 5;
                node.style.position = "relative";
                if (!widget.noHScroll) node.style.marginLeft = -dims.gutterTotalWidth + "px";
            }
        }

        // SELECTION / CURSOR

        function updateSelection(cm) {
            var display = cm.display;
            var collapsed = posEq(cm.doc.sel.from, cm.doc.sel.to);
            if (collapsed || cm.options.showCursorWhenSelecting)
                updateSelectionCursor(cm);
            else
                display.cursor.style.display = display.otherCursor.style.display = "none";
            if (!collapsed)
                updateSelectionRange(cm);
            else
                display.selectionDiv.style.display = "none";

            // Move the hidden textarea near the cursor to prevent scrolling artifacts
            if (cm.options.moveInputWithCursor) {
                var headPos = cursorCoords(cm, cm.doc.sel.head, "div");
                var wrapOff = getRect(display.wrapper), lineOff = getRect(display.lineDiv);
                display.inputDiv.style.top = Math.max(0, Math.min(display.wrapper.clientHeight - 10,
                    headPos.top + lineOff.top - wrapOff.top)) + "px";
                display.inputDiv.style.left = Math.max(0, Math.min(display.wrapper.clientWidth - 10,
                    headPos.left + lineOff.left - wrapOff.left)) + "px";
            }
        }

        // No selection, plain cursor
        function updateSelectionCursor(cm) {
            var display = cm.display, pos = cursorCoords(cm, cm.doc.sel.head, "div");
            display.cursor.style.left = pos.left + "px";
            display.cursor.style.top = pos.top + "px";
            display.cursor.style.height = Math.max(0, pos.bottom - pos.top) * cm.options.cursorHeight + "px";
            display.cursor.style.display = "";

            if (pos.other) {
                display.otherCursor.style.display = "";
                display.otherCursor.style.left = pos.other.left + "px";
                display.otherCursor.style.top = pos.other.top + "px";
                display.otherCursor.style.height = (pos.other.bottom - pos.other.top) * .85 + "px";
            } else { display.otherCursor.style.display = "none"; }
        }

        // Highlight selection
        function updateSelectionRange(cm) {
            var display = cm.display, doc = cm.doc, sel = cm.doc.sel;
            var fragment = document.createDocumentFragment();
            var clientWidth = display.lineSpace.offsetWidth, pl = paddingLeft(cm.display);

            function add(left, top, width, bottom) {
                if (top < 0) top = 0;
                fragment.appendChild(elt("div", null, "CodeMirror-selected", "position: absolute; left: " + left +
                "px; top: " + top + "px; width: " + (width == null ? clientWidth - left : width) +
                "px; height: " + (bottom - top) + "px"));
            }

            function drawForLine(line, fromArg, toArg) {
                var lineObj = getLine(doc, line);
                var lineLen = lineObj.text.length;
                var start, end;
                function coords(ch, bias) {
                    return charCoords(cm, Pos(line, ch), "div", lineObj, bias);
                }

                iterateBidiSections(getOrder(lineObj), fromArg || 0, toArg == null ? lineLen : toArg, function(from, to, dir) {
                    var leftPos = coords(from, "left"), rightPos, left, right;
                    if (from == to) {
                        rightPos = leftPos;
                        left = right = leftPos.left;
                    } else {
                        rightPos = coords(to - 1, "right");
                        if (dir == "rtl") { var tmp = leftPos; leftPos = rightPos; rightPos = tmp; }
                        left = leftPos.left;
                        right = rightPos.right;
                    }
                    if (fromArg == null && from == 0) left = pl;
                    if (rightPos.top - leftPos.top > 3) { // Different lines, draw top part
                        add(left, leftPos.top, null, leftPos.bottom);
                        left = pl;
                        if (leftPos.bottom < rightPos.top) add(left, leftPos.bottom, null, rightPos.top);
                    }
                    if (toArg == null && to == lineLen) right = clientWidth;
                    if (!start || leftPos.top < start.top || leftPos.top == start.top && leftPos.left < start.left)
                        start = leftPos;
                    if (!end || rightPos.bottom > end.bottom || rightPos.bottom == end.bottom && rightPos.right > end.right)
                        end = rightPos;
                    if (left < pl + 1) left = pl;
                    add(left, rightPos.top, right - left, rightPos.bottom);
                });
                return {start: start, end: end};
            }

            if (sel.from.line == sel.to.line) {
                drawForLine(sel.from.line, sel.from.ch, sel.to.ch);
            } else {
                var fromLine = getLine(doc, sel.from.line), toLine = getLine(doc, sel.to.line);
                var singleVLine = visualLine(doc, fromLine) == visualLine(doc, toLine);
                var leftEnd = drawForLine(sel.from.line, sel.from.ch, singleVLine ? fromLine.text.length : null).end;
                var rightStart = drawForLine(sel.to.line, singleVLine ? 0 : null, sel.to.ch).start;
                if (singleVLine) {
                    if (leftEnd.top < rightStart.top - 2) {
                        add(leftEnd.right, leftEnd.top, null, leftEnd.bottom);
                        add(pl, rightStart.top, rightStart.left, rightStart.bottom);
                    } else {
                        add(leftEnd.right, leftEnd.top, rightStart.left - leftEnd.right, leftEnd.bottom);
                    }
                }
                if (leftEnd.bottom < rightStart.top)
                    add(pl, leftEnd.bottom, null, rightStart.top);
            }

            removeChildrenAndAdd(display.selectionDiv, fragment);
            display.selectionDiv.style.display = "";
        }

        // Cursor-blinking
        function restartBlink(cm) {
            if (!cm.state.focused) return;
            var display = cm.display;
            clearInterval(display.blinker);
            var on = true;
            display.cursor.style.visibility = display.otherCursor.style.visibility = "";
            display.blinker = setInterval(function() {
                display.cursor.style.visibility = display.otherCursor.style.visibility = (on = !on) ? "" : "hidden";
            }, cm.options.cursorBlinkRate);
        }

        // HIGHLIGHT WORKER

        function startWorker(cm, time) {
            if (cm.doc.mode.startState && cm.doc.frontier < cm.display.showingTo)
                cm.state.highlight.set(time, bind(highlightWorker, cm));
        }

        function highlightWorker(cm) {
            var doc = cm.doc;
            if (doc.frontier < doc.first) doc.frontier = doc.first;
            if (doc.frontier >= cm.display.showingTo) return;
            var end = +new Date + cm.options.workTime;
            var state = copyState(doc.mode, getStateBefore(cm, doc.frontier));
            var changed = [], prevChange;
            doc.iter(doc.frontier, Math.min(doc.first + doc.size, cm.display.showingTo + 500), function(line) {
                if (doc.frontier >= cm.display.showingFrom) { // Visible
                    var oldStyles = line.styles;
                    line.styles = highlightLine(cm, line, state);
                    var ischange = !oldStyles || oldStyles.length != line.styles.length;
                    for (var i = 0; !ischange && i < oldStyles.length; ++i) ischange = oldStyles[i] != line.styles[i];
                    if (ischange) {
                        if (prevChange && prevChange.end == doc.frontier) prevChange.end++;
                        else changed.push(prevChange = {start: doc.frontier, end: doc.frontier + 1});
                    }
                    line.stateAfter = copyState(doc.mode, state);
                } else {
                    processLine(cm, line, state);
                    line.stateAfter = doc.frontier % 5 == 0 ? copyState(doc.mode, state) : null;
                }
                ++doc.frontier;
                if (+new Date > end) {
                    startWorker(cm, cm.options.workDelay);
                    return true;
                }
            });
            if (changed.length)
                operation(cm, function() {
                    for (var i = 0; i < changed.length; ++i)
                        regChange(this, changed[i].start, changed[i].end);
                })();
        }

        // Finds the line to start with when starting a parse. Tries to
        // find a line with a stateAfter, so that it can start with a
        // valid state. If that fails, it returns the line with the
        // smallest indentation, which tends to need the least context to
        // parse correctly.
        function findStartLine(cm, n, precise) {
            var minindent, minline, doc = cm.doc;
            for (var search = n, lim = n - 100; search > lim; --search) {
                if (search <= doc.first) return doc.first;
                var line = getLine(doc, search - 1);
                if (line.stateAfter && (!precise || search <= doc.frontier)) return search;
                var indented = countColumn(line.text, null, cm.options.tabSize);
                if (minline == null || minindent > indented) {
                    minline = search - 1;
                    minindent = indented;
                }
            }
            return minline;
        }

        function getStateBefore(cm, n, precise) {
            var doc = cm.doc, display = cm.display;
            if (!doc.mode.startState) return true;
            var pos = findStartLine(cm, n, precise), state = pos > doc.first && getLine(doc, pos-1).stateAfter;
            if (!state) state = startState(doc.mode);
            else state = copyState(doc.mode, state);
            doc.iter(pos, n, function(line) {
                processLine(cm, line, state);
                var save = pos == n - 1 || pos % 5 == 0 || pos >= display.showingFrom && pos < display.showingTo;
                line.stateAfter = save ? copyState(doc.mode, state) : null;
                ++pos;
            });
            return state;
        }

        // POSITION MEASUREMENT

        function paddingTop(display) {return display.lineSpace.offsetTop;}
        function paddingVert(display) {return display.mover.offsetHeight - display.lineSpace.offsetHeight;}
        function paddingLeft(display) {
            var e = removeChildrenAndAdd(display.measure, elt("pre", null, null, "text-align: left")).appendChild(elt("span", "x"));
            return e.offsetLeft;
        }

        function measureChar(cm, line, ch, data, bias) {
            var dir = -1;
            data = data || measureLine(cm, line);

            for (var pos = ch;; pos += dir) {
                var r = data[pos];
                if (r) break;
                if (dir < 0 && pos == 0) dir = 1;
            }
            bias = pos > ch ? "left" : pos < ch ? "right" : bias;
            if (bias == "left" && r.leftSide) r = r.leftSide;
            else if (bias == "right" && r.rightSide) r = r.rightSide;
            return {left: pos < ch ? r.right : r.left,
                right: pos > ch ? r.left : r.right,
                top: r.top,
                bottom: r.bottom};
        }

        function findCachedMeasurement(cm, line) {
            var cache = cm.display.measureLineCache;
            for (var i = 0; i < cache.length; ++i) {
                var memo = cache[i];
                if (memo.text == line.text && memo.markedSpans == line.markedSpans &&
                    cm.display.scroller.clientWidth == memo.width &&
                    memo.classes == line.textClass + "|" + line.bgClass + "|" + line.wrapClass)
                    return memo;
            }
        }

        function clearCachedMeasurement(cm, line) {
            var exists = findCachedMeasurement(cm, line);
            if (exists) exists.text = exists.measure = exists.markedSpans = null;
        }

        function measureLine(cm, line) {
            // First look in the cache
            var cached = findCachedMeasurement(cm, line);
            if (cached) return cached.measure;

            // Failing that, recompute and store result in cache
            var measure = measureLineInner(cm, line);
            var cache = cm.display.measureLineCache;
            var memo = {text: line.text, width: cm.display.scroller.clientWidth,
                markedSpans: line.markedSpans, measure: measure,
                classes: line.textClass + "|" + line.bgClass + "|" + line.wrapClass};
            if (cache.length == 16) cache[++cm.display.measureLineCachePos % 16] = memo;
            else cache.push(memo);
            return measure;
        }

        function measureLineInner(cm, line) {
            var display = cm.display, measure = emptyArray(line.text.length);
            var pre = lineContent(cm, line, measure, true);

            // IE does not cache element positions of inline elements between
            // calls to getBoundingClientRect. This makes the loop below,
            // which gathers the positions of all the characters on the line,
            // do an amount of layout work quadratic to the number of
            // characters. When line wrapping is off, we try to improve things
            // by first subdividing the line into a bunch of inline blocks, so
            // that IE can reuse most of the layout information from caches
            // for those blocks. This does interfere with line wrapping, so it
            // doesn't work when wrapping is on, but in that case the
            // situation is slightly better, since IE does cache line-wrapping
            // information and only recomputes per-line.
            if (ie && !ie_lt8 && !cm.options.lineWrapping && pre.childNodes.length > 100) {
                var fragment = document.createDocumentFragment();
                var chunk = 10, n = pre.childNodes.length;
                for (var i = 0, chunks = Math.ceil(n / chunk); i < chunks; ++i) {
                    var wrap = elt("div", null, null, "display: inline-block");
                    for (var j = 0; j < chunk && n; ++j) {
                        wrap.appendChild(pre.firstChild);
                        --n;
                    }
                    fragment.appendChild(wrap);
                }
                pre.appendChild(fragment);
            }

            removeChildrenAndAdd(display.measure, pre);

            var outer = getRect(display.lineDiv);
            var vranges = [], data = emptyArray(line.text.length), maxBot = pre.offsetHeight;
            // Work around an IE7/8 bug where it will sometimes have randomly
            // replaced our pre with a clone at this point.
            if (ie_lt9 && display.measure.first != pre)
                removeChildrenAndAdd(display.measure, pre);

            function measureRect(rect) {
                var top = rect.top - outer.top, bot = rect.bottom - outer.top;
                if (bot > maxBot) bot = maxBot;
                if (top < 0) top = 0;
                for (var i = vranges.length - 2; i >= 0; i -= 2) {
                    var rtop = vranges[i], rbot = vranges[i+1];
                    if (rtop > bot || rbot < top) continue;
                    if (rtop <= top && rbot >= bot ||
                        top <= rtop && bot >= rbot ||
                        Math.min(bot, rbot) - Math.max(top, rtop) >= (bot - top) >> 1) {
                        vranges[i] = Math.min(top, rtop);
                        vranges[i+1] = Math.max(bot, rbot);
                        break;
                    }
                }
                if (i < 0) { i = vranges.length; vranges.push(top, bot); }
                return {left: rect.left - outer.left,
                    right: rect.right - outer.left,
                    top: i, bottom: null};
            }
            function finishRect(rect) {
                rect.bottom = vranges[rect.top+1];
                rect.top = vranges[rect.top];
            }

            for (var i = 0, cur; i < measure.length; ++i) if (cur = measure[i]) {
                var node = cur, rect = null;
                // A widget might wrap, needs special care
                if (/\bCodeMirror-widget\b/.test(cur.className) && cur.getClientRects) {
                    if (cur.firstChild.nodeType == 1) node = cur.firstChild;
                    var rects = node.getClientRects();
                    if (rects.length > 1) {
                        rect = data[i] = measureRect(rects[0]);
                        rect.rightSide = measureRect(rects[rects.length - 1]);
                    }
                }
                if (!rect) rect = data[i] = measureRect(getRect(node));
                if (cur.measureRight) rect.right = getRect(cur.measureRight).left;
                if (cur.leftSide) rect.leftSide = measureRect(getRect(cur.leftSide));
            }
            for (var i = 0, cur; i < data.length; ++i) if (cur = data[i]) {
                finishRect(cur);
                if (cur.leftSide) finishRect(cur.leftSide);
                if (cur.rightSide) finishRect(cur.rightSide);
            }
            return data;
        }

        function measureLineWidth(cm, line) {
            var hasBadSpan = false;
            if (line.markedSpans) for (var i = 0; i < line.markedSpans; ++i) {
                var sp = line.markedSpans[i];
                if (sp.collapsed && (sp.to == null || sp.to == line.text.length)) hasBadSpan = true;
            }
            var cached = !hasBadSpan && findCachedMeasurement(cm, line);
            if (cached) return measureChar(cm, line, line.text.length, cached.measure, "right").right;

            var pre = lineContent(cm, line, null, true);
            var end = pre.appendChild(zeroWidthElement(cm.display.measure));
            removeChildrenAndAdd(cm.display.measure, pre);
            return getRect(end).right - getRect(cm.display.lineDiv).left;
        }

        function clearCaches(cm) {
            cm.display.measureLineCache.length = cm.display.measureLineCachePos = 0;
            cm.display.cachedCharWidth = cm.display.cachedTextHeight = null;
            if (!cm.options.lineWrapping) cm.display.maxLineChanged = true;
            cm.display.lineNumChars = null;
        }

        function pageScrollX() { return window.pageXOffset || (document.documentElement || document.body).scrollLeft; }
        function pageScrollY() { return window.pageYOffset || (document.documentElement || document.body).scrollTop; }

        // Context is one of "line", "div" (display.lineDiv), "local"/null (editor), or "page"
        function intoCoordSystem(cm, lineObj, rect, context) {
            if (lineObj.widgets) for (var i = 0; i < lineObj.widgets.length; ++i) if (lineObj.widgets[i].above) {
                var size = widgetHeight(lineObj.widgets[i]);
                rect.top += size; rect.bottom += size;
            }
            if (context == "line") return rect;
            if (!context) context = "local";
            var yOff = heightAtLine(cm, lineObj);
            if (context == "local") yOff += paddingTop(cm.display);
            else yOff -= cm.display.viewOffset;
            if (context == "page" || context == "window") {
                var lOff = getRect(cm.display.lineSpace);
                yOff += lOff.top + (context == "window" ? 0 : pageScrollY());
                var xOff = lOff.left + (context == "window" ? 0 : pageScrollX());
                rect.left += xOff; rect.right += xOff;
            }
            rect.top += yOff; rect.bottom += yOff;
            return rect;
        }

        // Context may be "window", "page", "div", or "local"/null
        // Result is in "div" coords
        function fromCoordSystem(cm, coords, context) {
            if (context == "div") return coords;
            var left = coords.left, top = coords.top;
            // First move into "page" coordinate system
            if (context == "page") {
                left -= pageScrollX();
                top -= pageScrollY();
            } else if (context == "local" || !context) {
                var localBox = getRect(cm.display.sizer);
                left += localBox.left;
                top += localBox.top;
            }

            var lineSpaceBox = getRect(cm.display.lineSpace);
            return {left: left - lineSpaceBox.left, top: top - lineSpaceBox.top};
        }

        function charCoords(cm, pos, context, lineObj, bias) {
            if (!lineObj) lineObj = getLine(cm.doc, pos.line);
            return intoCoordSystem(cm, lineObj, measureChar(cm, lineObj, pos.ch, null, bias), context);
        }

        function cursorCoords(cm, pos, context, lineObj, measurement) {
            lineObj = lineObj || getLine(cm.doc, pos.line);
            if (!measurement) measurement = measureLine(cm, lineObj);
            function get(ch, right) {
                var m = measureChar(cm, lineObj, ch, measurement, right ? "right" : "left");
                if (right) m.left = m.right; else m.right = m.left;
                return intoCoordSystem(cm, lineObj, m, context);
            }
            function getBidi(ch, partPos) {
                var part = order[partPos], right = part.level % 2;
                if (ch == bidiLeft(part) && partPos && part.level < order[partPos - 1].level) {
                    part = order[--partPos];
                    ch = bidiRight(part) - (part.level % 2 ? 0 : 1);
                    right = true;
                } else if (ch == bidiRight(part) && partPos < order.length - 1 && part.level < order[partPos + 1].level) {
                    part = order[++partPos];
                    ch = bidiLeft(part) - part.level % 2;
                    right = false;
                }
                if (right && ch == part.to && ch > part.from) return get(ch - 1);
                return get(ch, right);
            }
            var order = getOrder(lineObj), ch = pos.ch;
            if (!order) return get(ch);
            var partPos = getBidiPartAt(order, ch);
            var val = getBidi(ch, partPos);
            if (bidiOther != null) val.other = getBidi(ch, bidiOther);
            return val;
        }

        function PosWithInfo(line, ch, outside, xRel) {
            var pos = new Pos(line, ch);
            pos.xRel = xRel;
            if (outside) pos.outside = true;
            return pos;
        }

        // Coords must be lineSpace-local
        function coordsChar(cm, x, y) {
            var doc = cm.doc;
            y += cm.display.viewOffset;
            if (y < 0) return PosWithInfo(doc.first, 0, true, -1);
            var lineNo = lineAtHeight(doc, y), last = doc.first + doc.size - 1;
            if (lineNo > last)
                return PosWithInfo(doc.first + doc.size - 1, getLine(doc, last).text.length, true, 1);
            if (x < 0) x = 0;

            for (;;) {
                var lineObj = getLine(doc, lineNo);
                var found = coordsCharInner(cm, lineObj, lineNo, x, y);
                var merged = collapsedSpanAtEnd(lineObj);
                var mergedPos = merged && merged.find();
                if (merged && (found.ch > mergedPos.from.ch || found.ch == mergedPos.from.ch && found.xRel > 0))
                    lineNo = mergedPos.to.line;
                else
                    return found;
            }
        }

        function coordsCharInner(cm, lineObj, lineNo, x, y) {
            var innerOff = y - heightAtLine(cm, lineObj);
            var wrongLine = false, adjust = 2 * cm.display.wrapper.clientWidth;
            var measurement = measureLine(cm, lineObj);

            function getX(ch) {
                var sp = cursorCoords(cm, Pos(lineNo, ch), "line",
                    lineObj, measurement);
                wrongLine = true;
                if (innerOff > sp.bottom) return sp.left - adjust;
                else if (innerOff < sp.top) return sp.left + adjust;
                else wrongLine = false;
                return sp.left;
            }

            var bidi = getOrder(lineObj), dist = lineObj.text.length;
            var from = lineLeft(lineObj), to = lineRight(lineObj);
            var fromX = getX(from), fromOutside = wrongLine, toX = getX(to), toOutside = wrongLine;

            if (x > toX) return PosWithInfo(lineNo, to, toOutside, 1);
            // Do a binary search between these bounds.
            for (;;) {
                if (bidi ? to == from || to == moveVisually(lineObj, from, 1) : to - from <= 1) {
                    var ch = x < fromX || x - fromX <= toX - x ? from : to;
                    var xDiff = x - (ch == from ? fromX : toX);
                    while (isExtendingChar.test(lineObj.text.charAt(ch))) ++ch;
                    var pos = PosWithInfo(lineNo, ch, ch == from ? fromOutside : toOutside,
                        xDiff < 0 ? -1 : xDiff ? 1 : 0);
                    return pos;
                }
                var step = Math.ceil(dist / 2), middle = from + step;
                if (bidi) {
                    middle = from;
                    for (var i = 0; i < step; ++i) middle = moveVisually(lineObj, middle, 1);
                }
                var middleX = getX(middle);
                if (middleX > x) {to = middle; toX = middleX; if (toOutside = wrongLine) toX += 1000; dist = step;}
                else {from = middle; fromX = middleX; fromOutside = wrongLine; dist -= step;}
            }
        }

        var measureText;
        function textHeight(display) {
            if (display.cachedTextHeight != null) return display.cachedTextHeight;
            if (measureText == null) {
                measureText = elt("pre");
                // Measure a bunch of lines, for browsers that compute
                // fractional heights.
                for (var i = 0; i < 49; ++i) {
                    measureText.appendChild(document.createTextNode("x"));
                    measureText.appendChild(elt("br"));
                }
                measureText.appendChild(document.createTextNode("x"));
            }
            removeChildrenAndAdd(display.measure, measureText);
            var height = measureText.offsetHeight / 50;
            if (height > 3) display.cachedTextHeight = height;
            removeChildren(display.measure);
            return height || 1;
        }

        function charWidth(display) {
            if (display.cachedCharWidth != null) return display.cachedCharWidth;
            var anchor = elt("span", "x");
            var pre = elt("pre", [anchor]);
            removeChildrenAndAdd(display.measure, pre);
            var width = anchor.offsetWidth;
            if (width > 2) display.cachedCharWidth = width;
            return width || 10;
        }

        // OPERATIONS

        // Operations are used to wrap changes in such a way that each
        // change won't have to update the cursor and display (which would
        // be awkward, slow, and error-prone), but instead updates are
        // batched and then all combined and executed at once.

        var nextOpId = 0;
        function startOperation(cm) {
            cm.curOp = {
                // An array of ranges of lines that have to be updated. See
                // updateDisplay.
                changes: [],
                forceUpdate: false,
                updateInput: null,
                userSelChange: null,
                textChanged: null,
                selectionChanged: false,
                cursorActivity: false,
                updateMaxLine: false,
                updateScrollPos: false,
                id: ++nextOpId
            };
            if (!delayedCallbackDepth++) delayedCallbacks = [];
        }

        function endOperation(cm) {
            var op = cm.curOp, doc = cm.doc, display = cm.display;
            cm.curOp = null;

            if (op.updateMaxLine) computeMaxLength(cm);
            if (display.maxLineChanged && !cm.options.lineWrapping && display.maxLine) {
                var width = measureLineWidth(cm, display.maxLine);
                display.sizer.style.minWidth = Math.max(0, width + 3 + scrollerCutOff) + "px";
                display.maxLineChanged = false;
                var maxScrollLeft = Math.max(0, display.sizer.offsetLeft + display.sizer.offsetWidth - display.scroller.clientWidth);
                if (maxScrollLeft < doc.scrollLeft && !op.updateScrollPos)
                    setScrollLeft(cm, Math.min(display.scroller.scrollLeft, maxScrollLeft), true);
            }
            var newScrollPos, updated;
            if (op.updateScrollPos) {
                newScrollPos = op.updateScrollPos;
            } else if (op.selectionChanged && display.scroller.clientHeight) { // don't rescroll if not visible
                var coords = cursorCoords(cm, doc.sel.head);
                newScrollPos = calculateScrollPos(cm, coords.left, coords.top, coords.left, coords.bottom);
            }
            if (op.changes.length || op.forceUpdate || newScrollPos && newScrollPos.scrollTop != null) {
                updated = updateDisplay(cm, op.changes, newScrollPos && newScrollPos.scrollTop, op.forceUpdate);
                if (cm.display.scroller.offsetHeight) cm.doc.scrollTop = cm.display.scroller.scrollTop;
            }
            if (!updated && op.selectionChanged) updateSelection(cm);
            if (op.updateScrollPos) {
                display.scroller.scrollTop = display.scrollbarV.scrollTop = doc.scrollTop = newScrollPos.scrollTop;
                display.scroller.scrollLeft = display.scrollbarH.scrollLeft = doc.scrollLeft = newScrollPos.scrollLeft;
                alignHorizontally(cm);
                if (op.scrollToPos)
                    scrollPosIntoView(cm, clipPos(cm.doc, op.scrollToPos), op.scrollToPosMargin);
            } else if (newScrollPos) {
                scrollCursorIntoView(cm);
            }
            if (op.selectionChanged) restartBlink(cm);

            if (cm.state.focused && op.updateInput)
                resetInput(cm, op.userSelChange);

            var hidden = op.maybeHiddenMarkers, unhidden = op.maybeUnhiddenMarkers;
            if (hidden) for (var i = 0; i < hidden.length; ++i)
                if (!hidden[i].lines.length) signal(hidden[i], "hide");
            if (unhidden) for (var i = 0; i < unhidden.length; ++i)
                if (unhidden[i].lines.length) signal(unhidden[i], "unhide");

            var delayed;
            if (!--delayedCallbackDepth) {
                delayed = delayedCallbacks;
                delayedCallbacks = null;
            }
            if (op.textChanged)
                signal(cm, "change", cm, op.textChanged);
            if (op.cursorActivity) signal(cm, "cursorActivity", cm);
            if (delayed) for (var i = 0; i < delayed.length; ++i) delayed[i]();
        }

        // Wraps a function in an operation. Returns the wrapped function.
        function operation(cm1, f) {
            return function() {
                var cm = cm1 || this, withOp = !cm.curOp;
                if (withOp) startOperation(cm);
                try { var result = f.apply(cm, arguments); }
                finally { if (withOp) endOperation(cm); }
                return result;
            };
        }
        function docOperation(f) {
            return function() {
                var withOp = this.cm && !this.cm.curOp, result;
                if (withOp) startOperation(this.cm);
                try { result = f.apply(this, arguments); }
                finally { if (withOp) endOperation(this.cm); }
                return result;
            };
        }
        function runInOp(cm, f) {
            var withOp = !cm.curOp, result;
            if (withOp) startOperation(cm);
            try { result = f(); }
            finally { if (withOp) endOperation(cm); }
            return result;
        }

        function regChange(cm, from, to, lendiff) {
            if (from == null) from = cm.doc.first;
            if (to == null) to = cm.doc.first + cm.doc.size;
            cm.curOp.changes.push({from: from, to: to, diff: lendiff});
        }

        // INPUT HANDLING

        function slowPoll(cm) {
            if (cm.display.pollingFast) return;
            cm.display.poll.set(cm.options.pollInterval, function() {
                readInput(cm);
                if (cm.state.focused) slowPoll(cm);
            });
        }

        function fastPoll(cm) {
            var missed = false;
            cm.display.pollingFast = true;
            function p() {
                var changed = readInput(cm);
                if (!changed && !missed) {missed = true; cm.display.poll.set(60, p);}
                else {cm.display.pollingFast = false; slowPoll(cm);}
            }
            cm.display.poll.set(20, p);
        }

        // prevInput is a hack to work with IME. If we reset the textarea
        // on every change, that breaks IME. So we look for changes
        // compared to the previous content instead. (Modern browsers have
        // events that indicate IME taking place, but these are not widely
        // supported or compatible enough yet to rely on.)
        function readInput(cm) {
            var input = cm.display.input, prevInput = cm.display.prevInput, doc = cm.doc, sel = doc.sel;
            if (!cm.state.focused || hasSelection(input) || isReadOnly(cm) || cm.state.disableInput) return false;
            var text = input.value;
            if (text == prevInput && posEq(sel.from, sel.to)) return false;
            if (ie && !ie_lt9 && cm.display.inputHasSelection === text) {
                resetInput(cm, true);
                return false;
            }

            var withOp = !cm.curOp;
            if (withOp) startOperation(cm);
            sel.shift = false;
            var same = 0, l = Math.min(prevInput.length, text.length);
            while (same < l && prevInput.charCodeAt(same) == text.charCodeAt(same)) ++same;
            var from = sel.from, to = sel.to;
            if (same < prevInput.length)
                from = Pos(from.line, from.ch - (prevInput.length - same));
            else if (cm.state.overwrite && posEq(from, to) && !cm.state.pasteIncoming)
                to = Pos(to.line, Math.min(getLine(doc, to.line).text.length, to.ch + (text.length - same)));

            var updateInput = cm.curOp.updateInput;
            var changeEvent = {from: from, to: to, text: splitLines(text.slice(same)),
                origin: cm.state.pasteIncoming ? "paste" : "+input"};
            makeChange(cm.doc, changeEvent, "end");
            cm.curOp.updateInput = updateInput;
            signalLater(cm, "inputRead", cm, changeEvent);

            if (text.length > 1000 || text.indexOf("\n") > -1) input.value = cm.display.prevInput = "";
            else cm.display.prevInput = text;
            if (withOp) endOperation(cm);
            cm.state.pasteIncoming = false;
            return true;
        }

        function resetInput(cm, user) {
            var minimal, selected, doc = cm.doc;
            if (!posEq(doc.sel.from, doc.sel.to)) {
                cm.display.prevInput = "";
                minimal = hasCopyEvent &&
                (doc.sel.to.line - doc.sel.from.line > 100 || (selected = cm.getSelection()).length > 1000);
                var content = minimal ? "-" : selected || cm.getSelection();
                cm.display.input.value = content;
                if (cm.state.focused) selectInput(cm.display.input);
                if (ie && !ie_lt9) cm.display.inputHasSelection = content;
            } else if (user) {
                cm.display.prevInput = cm.display.input.value = "";
                if (ie && !ie_lt9) cm.display.inputHasSelection = null;
            }
            cm.display.inaccurateSelection = minimal;
        }

        function focusInput(cm) {
            if (cm.options.readOnly != "nocursor" && (!mobile || document.activeElement != cm.display.input))
                cm.display.input.focus();
        }

        function isReadOnly(cm) {
            return cm.options.readOnly || cm.doc.cantEdit;
        }

        // EVENT HANDLERS

        function registerEventHandlers(cm) {
            var d = cm.display;
            on(d.scroller, "mousedown", operation(cm, onMouseDown));
            if (ie)
                on(d.scroller, "dblclick", operation(cm, function(e) {
                    if (signalDOMEvent(cm, e)) return;
                    var pos = posFromMouse(cm, e);
                    if (!pos || clickInGutter(cm, e) || eventInWidget(cm.display, e)) return;
                    e_preventDefault(e);
                    var word = findWordAt(getLine(cm.doc, pos.line).text, pos);
                    extendSelection(cm.doc, word.from, word.to);
                }));
            else
                on(d.scroller, "dblclick", function(e) { signalDOMEvent(cm, e) || e_preventDefault(e); });
            on(d.lineSpace, "selectstart", function(e) {
                if (!eventInWidget(d, e)) e_preventDefault(e);
            });
            // Gecko browsers fire contextmenu *after* opening the menu, at
            // which point we can't mess with it anymore. Context menu is
            // handled in onMouseDown for Gecko.
            if (!captureMiddleClick) on(d.scroller, "contextmenu", function(e) {onContextMenu(cm, e);});

            on(d.scroller, "scroll", function() {
                if (d.scroller.clientHeight) {
                    setScrollTop(cm, d.scroller.scrollTop);
                    setScrollLeft(cm, d.scroller.scrollLeft, true);
                    signal(cm, "scroll", cm);
                }
            });
            on(d.scrollbarV, "scroll", function() {
                if (d.scroller.clientHeight) setScrollTop(cm, d.scrollbarV.scrollTop);
            });
            on(d.scrollbarH, "scroll", function() {
                if (d.scroller.clientHeight) setScrollLeft(cm, d.scrollbarH.scrollLeft);
            });

            on(d.scroller, "mousewheel", function(e){onScrollWheel(cm, e);});
            on(d.scroller, "DOMMouseScroll", function(e){onScrollWheel(cm, e);});

            function reFocus() { if (cm.state.focused) setTimeout(bind(focusInput, cm), 0); }
            on(d.scrollbarH, "mousedown", reFocus);
            on(d.scrollbarV, "mousedown", reFocus);
            // Prevent wrapper from ever scrolling
            on(d.wrapper, "scroll", function() { d.wrapper.scrollTop = d.wrapper.scrollLeft = 0; });

            var resizeTimer;
            function onResize() {
                if (resizeTimer == null) resizeTimer = setTimeout(function() {
                    resizeTimer = null;
                    // Might be a text scaling operation, clear size caches.
                    d.cachedCharWidth = d.cachedTextHeight = knownScrollbarWidth = null;
                    clearCaches(cm);
                    runInOp(cm, bind(regChange, cm));
                }, 100);
            }
            on(window, "resize", onResize);
            // Above handler holds on to the editor and its data structures.
            // Here we poll to unregister it when the editor is no longer in
            // the document, so that it can be garbage-collected.
            function unregister() {
                for (var p = d.wrapper.parentNode; p && p != document.body; p = p.parentNode) {}
                if (p) setTimeout(unregister, 5000);
                else off(window, "resize", onResize);
            }
            setTimeout(unregister, 5000);

            on(d.input, "keyup", operation(cm, function(e) {
                if (signalDOMEvent(cm, e) || cm.options.onKeyEvent && cm.options.onKeyEvent(cm, addStop(e))) return;
                if (e.keyCode == 16) cm.doc.sel.shift = false;
            }));
            on(d.input, "input", bind(fastPoll, cm));
            on(d.input, "keydown", operation(cm, onKeyDown));
            on(d.input, "keypress", operation(cm, onKeyPress));
            on(d.input, "focus", bind(onFocus, cm));
            on(d.input, "blur", bind(onBlur, cm));

            function drag_(e) {
                if (signalDOMEvent(cm, e) || cm.options.onDragEvent && cm.options.onDragEvent(cm, addStop(e))) return;
                e_stop(e);
            }
            if (cm.options.dragDrop) {
                on(d.scroller, "dragstart", function(e){onDragStart(cm, e);});
                on(d.scroller, "dragenter", drag_);
                on(d.scroller, "dragover", drag_);
                on(d.scroller, "drop", operation(cm, onDrop));
            }
            on(d.scroller, "paste", function(e){
                if (eventInWidget(d, e)) return;
                focusInput(cm);
                fastPoll(cm);
            });
            on(d.input, "paste", function() {
                cm.state.pasteIncoming = true;
                fastPoll(cm);
            });

            function prepareCopy() {
                if (d.inaccurateSelection) {
                    d.prevInput = "";
                    d.inaccurateSelection = false;
                    d.input.value = cm.getSelection();
                    selectInput(d.input);
                }
            }
            on(d.input, "cut", prepareCopy);
            on(d.input, "copy", prepareCopy);

            // Needed to handle Tab key in KHTML
            if (khtml) on(d.sizer, "mouseup", function() {
                if (document.activeElement == d.input) d.input.blur();
                focusInput(cm);
            });
        }

        function eventInWidget(display, e) {
            for (var n = e_target(e); n != display.wrapper; n = n.parentNode) {
                if (!n || n.ignoreEvents || n.parentNode == display.sizer && n != display.mover) return true;
            }
        }

        function posFromMouse(cm, e, liberal) {
            var display = cm.display;
            if (!liberal) {
                var target = e_target(e);
                if (target == display.scrollbarH || target == display.scrollbarH.firstChild ||
                    target == display.scrollbarV || target == display.scrollbarV.firstChild ||
                    target == display.scrollbarFiller || target == display.gutterFiller) return null;
            }
            var x, y, space = getRect(display.lineSpace);
            // Fails unpredictably on IE[67] when mouse is dragged around quickly.
            try { x = e.clientX; y = e.clientY; } catch (e) { return null; }
            return coordsChar(cm, x - space.left, y - space.top);
        }

        var lastClick, lastDoubleClick;
        function onMouseDown(e) {
            if (signalDOMEvent(this, e)) return;
            var cm = this, display = cm.display, doc = cm.doc, sel = doc.sel;
            sel.shift = e.shiftKey;

            if (eventInWidget(display, e)) {
                if (!webkit) {
                    display.scroller.draggable = false;
                    setTimeout(function(){display.scroller.draggable = true;}, 100);
                }
                return;
            }
            if (clickInGutter(cm, e)) return;
            var start = posFromMouse(cm, e);

            switch (e_button(e)) {
                case 3:
                    if (captureMiddleClick) onContextMenu.call(cm, cm, e);
                    return;
                case 2:
                    if (start) extendSelection(cm.doc, start);
                    setTimeout(bind(focusInput, cm), 20);
                    e_preventDefault(e);
                    return;
            }
            // For button 1, if it was clicked inside the editor
            // (posFromMouse returning non-null), we have to adjust the
            // selection.
            if (!start) {if (e_target(e) == display.scroller) e_preventDefault(e); return;}

            if (!cm.state.focused) onFocus(cm);

            var now = +new Date, type = "single";
            if (lastDoubleClick && lastDoubleClick.time > now - 400 && posEq(lastDoubleClick.pos, start)) {
                type = "triple";
                e_preventDefault(e);
                setTimeout(bind(focusInput, cm), 20);
                selectLine(cm, start.line);
            } else if (lastClick && lastClick.time > now - 400 && posEq(lastClick.pos, start)) {
                type = "double";
                lastDoubleClick = {time: now, pos: start};
                e_preventDefault(e);
                var word = findWordAt(getLine(doc, start.line).text, start);
                extendSelection(cm.doc, word.from, word.to);
            } else { lastClick = {time: now, pos: start}; }

            var last = start;
            if (cm.options.dragDrop && dragAndDrop && !isReadOnly(cm) && !posEq(sel.from, sel.to) &&
                !posLess(start, sel.from) && !posLess(sel.to, start) && type == "single") {
                var dragEnd = operation(cm, function(e2) {
                    if (webkit) display.scroller.draggable = false;
                    cm.state.draggingText = false;
                    off(document, "mouseup", dragEnd);
                    off(display.scroller, "drop", dragEnd);
                    if (Math.abs(e.clientX - e2.clientX) + Math.abs(e.clientY - e2.clientY) < 10) {
                        e_preventDefault(e2);
                        extendSelection(cm.doc, start);
                        focusInput(cm);
                    }
                });
                // Let the drag handler handle this.
                if (webkit) display.scroller.draggable = true;
                cm.state.draggingText = dragEnd;
                // IE's approach to draggable
                if (display.scroller.dragDrop) display.scroller.dragDrop();
                on(document, "mouseup", dragEnd);
                on(display.scroller, "drop", dragEnd);
                return;
            }
            e_preventDefault(e);
            if (type == "single") extendSelection(cm.doc, clipPos(doc, start));

            var startstart = sel.from, startend = sel.to, lastPos = start;

            function doSelect(cur) {
                if (posEq(lastPos, cur)) return;
                lastPos = cur;

                if (type == "single") {
                    extendSelection(cm.doc, clipPos(doc, start), cur);
                    return;
                }

                startstart = clipPos(doc, startstart);
                startend = clipPos(doc, startend);
                if (type == "double") {
                    var word = findWordAt(getLine(doc, cur.line).text, cur);
                    if (posLess(cur, startstart)) extendSelection(cm.doc, word.from, startend);
                    else extendSelection(cm.doc, startstart, word.to);
                } else if (type == "triple") {
                    if (posLess(cur, startstart)) extendSelection(cm.doc, startend, clipPos(doc, Pos(cur.line, 0)));
                    else extendSelection(cm.doc, startstart, clipPos(doc, Pos(cur.line + 1, 0)));
                }
            }

            var editorSize = getRect(display.wrapper);
            // Used to ensure timeout re-tries don't fire when another extend
            // happened in the meantime (clearTimeout isn't reliable -- at
            // least on Chrome, the timeouts still happen even when cleared,
            // if the clear happens after their scheduled firing time).
            var counter = 0;

            function extend(e) {
                var curCount = ++counter;
                var cur = posFromMouse(cm, e, true);
                if (!cur) return;
                if (!posEq(cur, last)) {
                    if (!cm.state.focused) onFocus(cm);
                    last = cur;
                    doSelect(cur);
                    var visible = visibleLines(display, doc);
                    if (cur.line >= visible.to || cur.line < visible.from)
                        setTimeout(operation(cm, function(){if (counter == curCount) extend(e);}), 150);
                } else {
                    var outside = e.clientY < editorSize.top ? -20 : e.clientY > editorSize.bottom ? 20 : 0;
                    if (outside) setTimeout(operation(cm, function() {
                        if (counter != curCount) return;
                        display.scroller.scrollTop += outside;
                        extend(e);
                    }), 50);
                }
            }

            function done(e) {
                counter = Infinity;
                e_preventDefault(e);
                focusInput(cm);
                off(document, "mousemove", move);
                off(document, "mouseup", up);
            }

            var move = operation(cm, function(e) {
                if (!ie && !e_button(e)) done(e);
                else extend(e);
            });
            var up = operation(cm, done);
            on(document, "mousemove", move);
            on(document, "mouseup", up);
        }

        function clickInGutter(cm, e) {
            var display = cm.display;
            try { var mX = e.clientX, mY = e.clientY; }
            catch(e) { return false; }

            if (mX >= Math.floor(getRect(display.gutters).right)) return false;
            e_preventDefault(e);
            if (!hasHandler(cm, "gutterClick")) return true;

            var lineBox = getRect(display.lineDiv);
            if (mY > lineBox.bottom) return true;
            mY -= lineBox.top - display.viewOffset;

            for (var i = 0; i < cm.options.gutters.length; ++i) {
                var g = display.gutters.childNodes[i];
                if (g && getRect(g).right >= mX) {
                    var line = lineAtHeight(cm.doc, mY);
                    var gutter = cm.options.gutters[i];
                    signalLater(cm, "gutterClick", cm, line, gutter, e);
                    break;
                }
            }
            return true;
        }

        // Kludge to work around strange IE behavior where it'll sometimes
        // re-fire a series of drag-related events right after the drop (#1551)
        var lastDrop = 0;

        function onDrop(e) {
            var cm = this;
            if (signalDOMEvent(cm, e) || eventInWidget(cm.display, e) || (cm.options.onDragEvent && cm.options.onDragEvent(cm, addStop(e))))
                return;
            e_preventDefault(e);
            if (ie) lastDrop = +new Date;
            var pos = posFromMouse(cm, e, true), files = e.dataTransfer.files;
            if (!pos || isReadOnly(cm)) return;
            if (files && files.length && window.FileReader && window.File) {
                var n = files.length, text = Array(n), read = 0;
                var loadFile = function(file, i) {
                    var reader = new FileReader;
                    reader.onload = function() {
                        text[i] = reader.result;
                        if (++read == n) {
                            pos = clipPos(cm.doc, pos);
                            makeChange(cm.doc, {from: pos, to: pos, text: splitLines(text.join("\n")), origin: "paste"}, "around");
                        }
                    };
                    reader.readAsText(file);
                };
                for (var i = 0; i < n; ++i) loadFile(files[i], i);
            } else {
                // Don't do a replace if the drop happened inside of the selected text.
                if (cm.state.draggingText && !(posLess(pos, cm.doc.sel.from) || posLess(cm.doc.sel.to, pos))) {
                    cm.state.draggingText(e);
                    // Ensure the editor is re-focused
                    setTimeout(bind(focusInput, cm), 20);
                    return;
                }
                try {
                    var text = e.dataTransfer.getData("Text");
                    if (text) {
                        var curFrom = cm.doc.sel.from, curTo = cm.doc.sel.to;
                        setSelection(cm.doc, pos, pos);
                        if (cm.state.draggingText) replaceRange(cm.doc, "", curFrom, curTo, "paste");
                        cm.replaceSelection(text, null, "paste");
                        focusInput(cm);
                        onFocus(cm);
                    }
                }
                catch(e){}
            }
        }

        function onDragStart(cm, e) {
            if (ie && (!cm.state.draggingText || +new Date - lastDrop < 100)) { e_stop(e); return; }
            if (signalDOMEvent(cm, e) || eventInWidget(cm.display, e)) return;

            var txt = cm.getSelection();
            e.dataTransfer.setData("Text", txt);

            // Use dummy image instead of default browsers image.
            // Recent Safari (~6.0.2) have a tendency to segfault when this happens, so we don't do it there.
            if (e.dataTransfer.setDragImage && !safari) {
                var img = elt("img", null, null, "position: fixed; left: 0; top: 0;");
                if (opera) {
                    img.width = img.height = 1;
                    cm.display.wrapper.appendChild(img);
                    // Force a relayout, or Opera won't use our image for some obscure reason
                    img._top = img.offsetTop;
                }
                e.dataTransfer.setDragImage(img, 0, 0);
                if (opera) img.parentNode.removeChild(img);
            }
        }

        function setScrollTop(cm, val) {
            if (Math.abs(cm.doc.scrollTop - val) < 2) return;
            cm.doc.scrollTop = val;
            if (!gecko) updateDisplay(cm, [], val);
            if (cm.display.scroller.scrollTop != val) cm.display.scroller.scrollTop = val;
            if (cm.display.scrollbarV.scrollTop != val) cm.display.scrollbarV.scrollTop = val;
            if (gecko) updateDisplay(cm, []);
            startWorker(cm, 100);
        }
        function setScrollLeft(cm, val, isScroller) {
            if (isScroller ? val == cm.doc.scrollLeft : Math.abs(cm.doc.scrollLeft - val) < 2) return;
            val = Math.min(val, cm.display.scroller.scrollWidth - cm.display.scroller.clientWidth);
            cm.doc.scrollLeft = val;
            alignHorizontally(cm);
            if (cm.display.scroller.scrollLeft != val) cm.display.scroller.scrollLeft = val;
            if (cm.display.scrollbarH.scrollLeft != val) cm.display.scrollbarH.scrollLeft = val;
        }

        // Since the delta values reported on mouse wheel events are
        // unstandardized between browsers and even browser versions, and
        // generally horribly unpredictable, this code starts by measuring
        // the scroll effect that the first few mouse wheel events have,
        // and, from that, detects the way it can convert deltas to pixel
        // offsets afterwards.
        //
        // The reason we want to know the amount a wheel event will scroll
        // is that it gives us a chance to update the display before the
        // actual scrolling happens, reducing flickering.

        var wheelSamples = 0, wheelPixelsPerUnit = null;
        // Fill in a browser-detected starting value on browsers where we
        // know one. These don't have to be accurate -- the result of them
        // being wrong would just be a slight flicker on the first wheel
        // scroll (if it is large enough).
        if (ie) wheelPixelsPerUnit = -.53;
        else if (gecko) wheelPixelsPerUnit = 15;
        else if (chrome) wheelPixelsPerUnit = -.7;
        else if (safari) wheelPixelsPerUnit = -1/3;

        function onScrollWheel(cm, e) {
            var dx = e.wheelDeltaX, dy = e.wheelDeltaY;
            if (dx == null && e.detail && e.axis == e.HORIZONTAL_AXIS) dx = e.detail;
            if (dy == null && e.detail && e.axis == e.VERTICAL_AXIS) dy = e.detail;
            else if (dy == null) dy = e.wheelDelta;

            var display = cm.display, scroll = display.scroller;
            // Quit if there's nothing to scroll here
            if (!(dx && scroll.scrollWidth > scroll.clientWidth ||
                dy && scroll.scrollHeight > scroll.clientHeight)) return;

            // Webkit browsers on OS X abort momentum scrolls when the target
            // of the scroll event is removed from the scrollable element.
            // This hack (see related code in patchDisplay) makes sure the
            // element is kept around.
            if (dy && mac && webkit) {
                for (var cur = e.target; cur != scroll; cur = cur.parentNode) {
                    if (cur.lineObj) {
                        cm.display.currentWheelTarget = cur;
                        break;
                    }
                }
            }

            // On some browsers, horizontal scrolling will cause redraws to
            // happen before the gutter has been realigned, causing it to
            // wriggle around in a most unseemly way. When we have an
            // estimated pixels/delta value, we just handle horizontal
            // scrolling entirely here. It'll be slightly off from native, but
            // better than glitching out.
            if (dx && !gecko && !opera && wheelPixelsPerUnit != null) {
                if (dy)
                    setScrollTop(cm, Math.max(0, Math.min(scroll.scrollTop + dy * wheelPixelsPerUnit, scroll.scrollHeight - scroll.clientHeight)));
                setScrollLeft(cm, Math.max(0, Math.min(scroll.scrollLeft + dx * wheelPixelsPerUnit, scroll.scrollWidth - scroll.clientWidth)));
                e_preventDefault(e);
                display.wheelStartX = null; // Abort measurement, if in progress
                return;
            }

            if (dy && wheelPixelsPerUnit != null) {
                var pixels = dy * wheelPixelsPerUnit;
                var top = cm.doc.scrollTop, bot = top + display.wrapper.clientHeight;
                if (pixels < 0) top = Math.max(0, top + pixels - 50);
                else bot = Math.min(cm.doc.height, bot + pixels + 50);
                updateDisplay(cm, [], {top: top, bottom: bot});
            }

            if (wheelSamples < 20) {
                if (display.wheelStartX == null) {
                    display.wheelStartX = scroll.scrollLeft; display.wheelStartY = scroll.scrollTop;
                    display.wheelDX = dx; display.wheelDY = dy;
                    setTimeout(function() {
                        if (display.wheelStartX == null) return;
                        var movedX = scroll.scrollLeft - display.wheelStartX;
                        var movedY = scroll.scrollTop - display.wheelStartY;
                        var sample = (movedY && display.wheelDY && movedY / display.wheelDY) ||
                            (movedX && display.wheelDX && movedX / display.wheelDX);
                        display.wheelStartX = display.wheelStartY = null;
                        if (!sample) return;
                        wheelPixelsPerUnit = (wheelPixelsPerUnit * wheelSamples + sample) / (wheelSamples + 1);
                        ++wheelSamples;
                    }, 200);
                } else {
                    display.wheelDX += dx; display.wheelDY += dy;
                }
            }
        }

        function doHandleBinding(cm, bound, dropShift) {
            if (typeof bound == "string") {
                bound = commands[bound];
                if (!bound) return false;
            }
            // Ensure previous input has been read, so that the handler sees a
            // consistent view of the document
            if (cm.display.pollingFast && readInput(cm)) cm.display.pollingFast = false;
            var doc = cm.doc, prevShift = doc.sel.shift, done = false;
            try {
                if (isReadOnly(cm)) cm.state.suppressEdits = true;
                if (dropShift) doc.sel.shift = false;
                done = bound(cm) != Pass;
            } finally {
                doc.sel.shift = prevShift;
                cm.state.suppressEdits = false;
            }
            return done;
        }

        function allKeyMaps(cm) {
            var maps = cm.state.keyMaps.slice(0);
            if (cm.options.extraKeys) maps.push(cm.options.extraKeys);
            maps.push(cm.options.keyMap);
            return maps;
        }

        var maybeTransition;
        function handleKeyBinding(cm, e) {
            // Handle auto keymap transitions
            var startMap = getKeyMap(cm.options.keyMap), next = startMap.auto;
            clearTimeout(maybeTransition);
            if (next && !isModifierKey(e)) maybeTransition = setTimeout(function() {
                if (getKeyMap(cm.options.keyMap) == startMap) {
                    cm.options.keyMap = (next.call ? next.call(null, cm) : next);
                    keyMapChanged(cm);
                }
            }, 50);

            var name = keyName(e, true), handled = false;
            if (!name) return false;
            var keymaps = allKeyMaps(cm);

            if (e.shiftKey) {
                // First try to resolve full name (including 'Shift-'). Failing
                // that, see if there is a cursor-motion command (starting with
                // 'go') bound to the keyname without 'Shift-'.
                handled = lookupKey("Shift-" + name, keymaps, function(b) {return doHandleBinding(cm, b, true);})
                || lookupKey(name, keymaps, function(b) {
                    if (typeof b == "string" ? /^go[A-Z]/.test(b) : b.motion)
                        return doHandleBinding(cm, b);
                });
            } else {
                handled = lookupKey(name, keymaps, function(b) { return doHandleBinding(cm, b); });
            }

            if (handled) {
                e_preventDefault(e);
                restartBlink(cm);
                if (ie_lt9) { e.oldKeyCode = e.keyCode; e.keyCode = 0; }
                signalLater(cm, "keyHandled", cm, name, e);
            }
            return handled;
        }

        function handleCharBinding(cm, e, ch) {
            var handled = lookupKey("'" + ch + "'", allKeyMaps(cm),
                function(b) { return doHandleBinding(cm, b, true); });
            if (handled) {
                e_preventDefault(e);
                restartBlink(cm);
                signalLater(cm, "keyHandled", cm, "'" + ch + "'", e);
            }
            return handled;
        }

        var lastStoppedKey = null;
        function onKeyDown(e) {
            var cm = this;
            if (!cm.state.focused) onFocus(cm);
            if (ie && e.keyCode == 27) { e.returnValue = false; }
            if (signalDOMEvent(cm, e) || cm.options.onKeyEvent && cm.options.onKeyEvent(cm, addStop(e))) return;
            var code = e.keyCode;
            // IE does strange things with escape.
            cm.doc.sel.shift = code == 16 || e.shiftKey;
            // First give onKeyEvent option a chance to handle this.
            var handled = handleKeyBinding(cm, e);
            if (opera) {
                lastStoppedKey = handled ? code : null;
                // Opera has no cut event... we try to at least catch the key combo
                if (!handled && code == 88 && !hasCopyEvent && (mac ? e.metaKey : e.ctrlKey))
                    cm.replaceSelection("");
            }
        }

        function onKeyPress(e) {
            var cm = this;
            if (signalDOMEvent(cm, e) || cm.options.onKeyEvent && cm.options.onKeyEvent(cm, addStop(e))) return;
            var keyCode = e.keyCode, charCode = e.charCode;
            if (opera && keyCode == lastStoppedKey) {lastStoppedKey = null; e_preventDefault(e); return;}
            if (((opera && (!e.which || e.which < 10)) || khtml) && handleKeyBinding(cm, e)) return;
            var ch = String.fromCharCode(charCode == null ? keyCode : charCode);
            if (this.options.electricChars && this.doc.mode.electricChars &&
                this.options.smartIndent && !isReadOnly(this) &&
                this.doc.mode.electricChars.indexOf(ch) > -1)
                setTimeout(operation(cm, function() {indentLine(cm, cm.doc.sel.to.line, "smart");}), 75);
            if (handleCharBinding(cm, e, ch)) return;
            if (ie && !ie_lt9) cm.display.inputHasSelection = null;
            fastPoll(cm);
        }

        function onFocus(cm) {
            if (cm.options.readOnly == "nocursor") return;
            if (!cm.state.focused) {
                signal(cm, "focus", cm);
                cm.state.focused = true;
                if (cm.display.wrapper.className.search(/\bCodeMirror-focused\b/) == -1)
                    cm.display.wrapper.className += " CodeMirror-focused";
                resetInput(cm, true);
            }
            slowPoll(cm);
            restartBlink(cm);
        }
        function onBlur(cm) {
            if (cm.state.focused) {
                signal(cm, "blur", cm);
                cm.state.focused = false;
                cm.display.wrapper.className = cm.display.wrapper.className.replace(" CodeMirror-focused", "");
            }
            clearInterval(cm.display.blinker);
            setTimeout(function() {if (!cm.state.focused) cm.doc.sel.shift = false;}, 150);
        }

        var detectingSelectAll;
        function onContextMenu(cm, e) {
            if (signalDOMEvent(cm, e, "contextmenu")) return;
            var display = cm.display, sel = cm.doc.sel;
            if (eventInWidget(display, e)) return;

            var pos = posFromMouse(cm, e), scrollPos = display.scroller.scrollTop;
            if (!pos || opera) return; // Opera is difficult.
            if (posEq(sel.from, sel.to) || posLess(pos, sel.from) || !posLess(pos, sel.to))
                operation(cm, setSelection)(cm.doc, pos, pos);

            var oldCSS = display.input.style.cssText;
            display.inputDiv.style.position = "absolute";
            display.input.style.cssText = "position: fixed; width: 30px; height: 30px; top: " + (e.clientY - 5) +
            "px; left: " + (e.clientX - 5) + "px; z-index: 1000; background: white; outline: none;" +
            "border-width: 0; outline: none; overflow: hidden; opacity: .05; -ms-opacity: .05; filter: alpha(opacity=5);";
            focusInput(cm);
            resetInput(cm, true);
            // Adds "Select all" to context menu in FF
            if (posEq(sel.from, sel.to)) display.input.value = display.prevInput = " ";

            function prepareSelectAllHack() {
                if (display.input.selectionStart != null) {
                    var extval = display.input.value = " " + (posEq(sel.from, sel.to) ? "" : display.input.value);
                    display.prevInput = " ";
                    display.input.selectionStart = 1; display.input.selectionEnd = extval.length;
                }
            }
            function rehide() {
                display.inputDiv.style.position = "relative";
                display.input.style.cssText = oldCSS;
                if (ie_lt9) display.scrollbarV.scrollTop = display.scroller.scrollTop = scrollPos;
                slowPoll(cm);

                // Try to detect the user choosing select-all
                if (display.input.selectionStart != null) {
                    if (!ie || ie_lt9) prepareSelectAllHack();
                    clearTimeout(detectingSelectAll);
                    var i = 0, poll = function(){
                        if (display.prevInput == " " && display.input.selectionStart == 0)
                            operation(cm, commands.selectAll)(cm);
                        else if (i++ < 10) detectingSelectAll = setTimeout(poll, 500);
                        else resetInput(cm);
                    };
                    detectingSelectAll = setTimeout(poll, 200);
                }
            }

            if (ie && !ie_lt9) prepareSelectAllHack();
            if (captureMiddleClick) {
                e_stop(e);
                var mouseup = function() {
                    off(window, "mouseup", mouseup);
                    setTimeout(rehide, 20);
                };
                on(window, "mouseup", mouseup);
            } else {
                setTimeout(rehide, 50);
            }
        }

        // UPDATING

        var changeEnd = CodeMirror.changeEnd = function(change) {
            if (!change.text) return change.to;
            return Pos(change.from.line + change.text.length - 1,
                lst(change.text).length + (change.text.length == 1 ? change.from.ch : 0));
        };

        // Make sure a position will be valid after the given change.
        function clipPostChange(doc, change, pos) {
            if (!posLess(change.from, pos)) return clipPos(doc, pos);
            var diff = (change.text.length - 1) - (change.to.line - change.from.line);
            if (pos.line > change.to.line + diff) {
                var preLine = pos.line - diff, lastLine = doc.first + doc.size - 1;
                if (preLine > lastLine) return Pos(lastLine, getLine(doc, lastLine).text.length);
                return clipToLen(pos, getLine(doc, preLine).text.length);
            }
            if (pos.line == change.to.line + diff)
                return clipToLen(pos, lst(change.text).length + (change.text.length == 1 ? change.from.ch : 0) +
                getLine(doc, change.to.line).text.length - change.to.ch);
            var inside = pos.line - change.from.line;
            return clipToLen(pos, change.text[inside].length + (inside ? 0 : change.from.ch));
        }

        // Hint can be null|"end"|"start"|"around"|{anchor,head}
        function computeSelAfterChange(doc, change, hint) {
            if (hint && typeof hint == "object") // Assumed to be {anchor, head} object
                return {anchor: clipPostChange(doc, change, hint.anchor),
                    head: clipPostChange(doc, change, hint.head)};

            if (hint == "start") return {anchor: change.from, head: change.from};

            var end = changeEnd(change);
            if (hint == "around") return {anchor: change.from, head: end};
            if (hint == "end") return {anchor: end, head: end};

            // hint is null, leave the selection alone as much as possible
            var adjustPos = function(pos) {
                if (posLess(pos, change.from)) return pos;
                if (!posLess(change.to, pos)) return end;

                var line = pos.line + change.text.length - (change.to.line - change.from.line) - 1, ch = pos.ch;
                if (pos.line == change.to.line) ch += end.ch - change.to.ch;
                return Pos(line, ch);
            };
            return {anchor: adjustPos(doc.sel.anchor), head: adjustPos(doc.sel.head)};
        }

        function filterChange(doc, change, update) {
            var obj = {
                canceled: false,
                from: change.from,
                to: change.to,
                text: change.text,
                origin: change.origin,
                cancel: function() { this.canceled = true; }
            };
            if (update) obj.update = function(from, to, text, origin) {
                if (from) this.from = clipPos(doc, from);
                if (to) this.to = clipPos(doc, to);
                if (text) this.text = text;
                if (origin !== undefined) this.origin = origin;
            };
            signal(doc, "beforeChange", doc, obj);
            if (doc.cm) signal(doc.cm, "beforeChange", doc.cm, obj);

            if (obj.canceled) return null;
            return {from: obj.from, to: obj.to, text: obj.text, origin: obj.origin};
        }

        // Replace the range from from to to by the strings in replacement.
        // change is a {from, to, text [, origin]} object
        function makeChange(doc, change, selUpdate, ignoreReadOnly) {
            if (doc.cm) {
                if (!doc.cm.curOp) return operation(doc.cm, makeChange)(doc, change, selUpdate, ignoreReadOnly);
                if (doc.cm.state.suppressEdits) return;
            }

            if (hasHandler(doc, "beforeChange") || doc.cm && hasHandler(doc.cm, "beforeChange")) {
                change = filterChange(doc, change, true);
                if (!change) return;
            }

            // Possibly split or suppress the update based on the presence
            // of read-only spans in its range.
            var split = sawReadOnlySpans && !ignoreReadOnly && removeReadOnlyRanges(doc, change.from, change.to);
            if (split) {
                for (var i = split.length - 1; i >= 1; --i)
                    makeChangeNoReadonly(doc, {from: split[i].from, to: split[i].to, text: [""]});
                if (split.length)
                    makeChangeNoReadonly(doc, {from: split[0].from, to: split[0].to, text: change.text}, selUpdate);
            } else {
                makeChangeNoReadonly(doc, change, selUpdate);
            }
        }

        function makeChangeNoReadonly(doc, change, selUpdate) {
            var selAfter = computeSelAfterChange(doc, change, selUpdate);
            addToHistory(doc, change, selAfter, doc.cm ? doc.cm.curOp.id : NaN);

            makeChangeSingleDoc(doc, change, selAfter, stretchSpansOverChange(doc, change));
            var rebased = [];

            linkedDocs(doc, function(doc, sharedHist) {
                if (!sharedHist && indexOf(rebased, doc.history) == -1) {
                    rebaseHist(doc.history, change);
                    rebased.push(doc.history);
                }
                makeChangeSingleDoc(doc, change, null, stretchSpansOverChange(doc, change));
            });
        }

        function makeChangeFromHistory(doc, type) {
            if (doc.cm && doc.cm.state.suppressEdits) return;

            var hist = doc.history;
            var event = (type == "undo" ? hist.done : hist.undone).pop();
            if (!event) return;

            var anti = {changes: [], anchorBefore: event.anchorAfter, headBefore: event.headAfter,
                anchorAfter: event.anchorBefore, headAfter: event.headBefore,
                generation: hist.generation};
            (type == "undo" ? hist.undone : hist.done).push(anti);
            hist.generation = event.generation || ++hist.maxGeneration;

            var filter = hasHandler(doc, "beforeChange") || doc.cm && hasHandler(doc.cm, "beforeChange");

            for (var i = event.changes.length - 1; i >= 0; --i) {
                var change = event.changes[i];
                change.origin = type;
                if (filter && !filterChange(doc, change, false)) {
                    (type == "undo" ? hist.done : hist.undone).length = 0;
                    return;
                }

                anti.changes.push(historyChangeFromChange(doc, change));

                var after = i ? computeSelAfterChange(doc, change, null)
                    : {anchor: event.anchorBefore, head: event.headBefore};
                makeChangeSingleDoc(doc, change, after, mergeOldSpans(doc, change));
                var rebased = [];

                linkedDocs(doc, function(doc, sharedHist) {
                    if (!sharedHist && indexOf(rebased, doc.history) == -1) {
                        rebaseHist(doc.history, change);
                        rebased.push(doc.history);
                    }
                    makeChangeSingleDoc(doc, change, null, mergeOldSpans(doc, change));
                });
            }
        }

        function shiftDoc(doc, distance) {
            function shiftPos(pos) {return Pos(pos.line + distance, pos.ch);}
            doc.first += distance;
            if (doc.cm) regChange(doc.cm, doc.first, doc.first, distance);
            doc.sel.head = shiftPos(doc.sel.head); doc.sel.anchor = shiftPos(doc.sel.anchor);
            doc.sel.from = shiftPos(doc.sel.from); doc.sel.to = shiftPos(doc.sel.to);
        }

        function makeChangeSingleDoc(doc, change, selAfter, spans) {
            if (doc.cm && !doc.cm.curOp)
                return operation(doc.cm, makeChangeSingleDoc)(doc, change, selAfter, spans);

            if (change.to.line < doc.first) {
                shiftDoc(doc, change.text.length - 1 - (change.to.line - change.from.line));
                return;
            }
            if (change.from.line > doc.lastLine()) return;

            // Clip the change to the size of this doc
            if (change.from.line < doc.first) {
                var shift = change.text.length - 1 - (doc.first - change.from.line);
                shiftDoc(doc, shift);
                change = {from: Pos(doc.first, 0), to: Pos(change.to.line + shift, change.to.ch),
                    text: [lst(change.text)], origin: change.origin};
            }
            var last = doc.lastLine();
            if (change.to.line > last) {
                change = {from: change.from, to: Pos(last, getLine(doc, last).text.length),
                    text: [change.text[0]], origin: change.origin};
            }

            change.removed = getBetween(doc, change.from, change.to);

            if (!selAfter) selAfter = computeSelAfterChange(doc, change, null);
            if (doc.cm) makeChangeSingleDocInEditor(doc.cm, change, spans, selAfter);
            else updateDoc(doc, change, spans, selAfter);
        }

        function makeChangeSingleDocInEditor(cm, change, spans, selAfter) {
            var doc = cm.doc, display = cm.display, from = change.from, to = change.to;

            var recomputeMaxLength = false, checkWidthStart = from.line;
            if (!cm.options.lineWrapping) {
                checkWidthStart = lineNo(visualLine(doc, getLine(doc, from.line)));
                doc.iter(checkWidthStart, to.line + 1, function(line) {
                    if (line == display.maxLine) {
                        recomputeMaxLength = true;
                        return true;
                    }
                });
            }

            if (!posLess(doc.sel.head, change.from) && !posLess(change.to, doc.sel.head))
                cm.curOp.cursorActivity = true;

            updateDoc(doc, change, spans, selAfter, estimateHeight(cm));

            if (!cm.options.lineWrapping) {
                doc.iter(checkWidthStart, from.line + change.text.length, function(line) {
                    var len = lineLength(doc, line);
                    if (len > display.maxLineLength) {
                        display.maxLine = line;
                        display.maxLineLength = len;
                        display.maxLineChanged = true;
                        recomputeMaxLength = false;
                    }
                });
                if (recomputeMaxLength) cm.curOp.updateMaxLine = true;
            }

            // Adjust frontier, schedule worker
            doc.frontier = Math.min(doc.frontier, from.line);
            startWorker(cm, 400);

            var lendiff = change.text.length - (to.line - from.line) - 1;
            // Remember that these lines changed, for updating the display
            regChange(cm, from.line, to.line + 1, lendiff);

            if (hasHandler(cm, "change")) {
                var changeObj = {from: from, to: to,
                    text: change.text,
                    removed: change.removed,
                    origin: change.origin};
                if (cm.curOp.textChanged) {
                    for (var cur = cm.curOp.textChanged; cur.next; cur = cur.next) {}
                    cur.next = changeObj;
                } else cm.curOp.textChanged = changeObj;
            }
        }

        function replaceRange(doc, code, from, to, origin) {
            if (!to) to = from;
            if (posLess(to, from)) { var tmp = to; to = from; from = tmp; }
            if (typeof code == "string") code = splitLines(code);
            makeChange(doc, {from: from, to: to, text: code, origin: origin}, null);
        }

        // POSITION OBJECT

        function Pos(line, ch) {
            if (!(this instanceof Pos)) return new Pos(line, ch);
            this.line = line; this.ch = ch;
        }
        CodeMirror.Pos = Pos;

        function posEq(a, b) {return a.line == b.line && a.ch == b.ch;}
        function posLess(a, b) {return a.line < b.line || (a.line == b.line && a.ch < b.ch);}
        function copyPos(x) {return Pos(x.line, x.ch);}

        // SELECTION

        function clipLine(doc, n) {return Math.max(doc.first, Math.min(n, doc.first + doc.size - 1));}
        function clipPos(doc, pos) {
            if (pos.line < doc.first) return Pos(doc.first, 0);
            var last = doc.first + doc.size - 1;
            if (pos.line > last) return Pos(last, getLine(doc, last).text.length);
            return clipToLen(pos, getLine(doc, pos.line).text.length);
        }
        function clipToLen(pos, linelen) {
            var ch = pos.ch;
            if (ch == null || ch > linelen) return Pos(pos.line, linelen);
            else if (ch < 0) return Pos(pos.line, 0);
            else return pos;
        }
        function isLine(doc, l) {return l >= doc.first && l < doc.first + doc.size;}

        // If shift is held, this will move the selection anchor. Otherwise,
        // it'll set the whole selection.
        function extendSelection(doc, pos, other, bias) {
            if (doc.sel.shift || doc.sel.extend) {
                var anchor = doc.sel.anchor;
                if (other) {
                    var posBefore = posLess(pos, anchor);
                    if (posBefore != posLess(other, anchor)) {
                        anchor = pos;
                        pos = other;
                    } else if (posBefore != posLess(pos, other)) {
                        pos = other;
                    }
                }
                setSelection(doc, anchor, pos, bias);
            } else {
                setSelection(doc, pos, other || pos, bias);
            }
            if (doc.cm) doc.cm.curOp.userSelChange = true;
        }

        function filterSelectionChange(doc, anchor, head) {
            var obj = {anchor: anchor, head: head};
            signal(doc, "beforeSelectionChange", doc, obj);
            if (doc.cm) signal(doc.cm, "beforeSelectionChange", doc.cm, obj);
            obj.anchor = clipPos(doc, obj.anchor); obj.head = clipPos(doc, obj.head);
            return obj;
        }

        // Update the selection. Last two args are only used by
        // updateDoc, since they have to be expressed in the line
        // numbers before the update.
        function setSelection(doc, anchor, head, bias, checkAtomic) {
            if (!checkAtomic && hasHandler(doc, "beforeSelectionChange") || doc.cm && hasHandler(doc.cm, "beforeSelectionChange")) {
                var filtered = filterSelectionChange(doc, anchor, head);
                head = filtered.head;
                anchor = filtered.anchor;
            }

            var sel = doc.sel;
            sel.goalColumn = null;
            // Skip over atomic spans.
            if (checkAtomic || !posEq(anchor, sel.anchor))
                anchor = skipAtomic(doc, anchor, bias, checkAtomic != "push");
            if (checkAtomic || !posEq(head, sel.head))
                head = skipAtomic(doc, head, bias, checkAtomic != "push");

            if (posEq(sel.anchor, anchor) && posEq(sel.head, head)) return;

            sel.anchor = anchor; sel.head = head;
            var inv = posLess(head, anchor);
            sel.from = inv ? head : anchor;
            sel.to = inv ? anchor : head;

            if (doc.cm)
                doc.cm.curOp.updateInput = doc.cm.curOp.selectionChanged =
                    doc.cm.curOp.cursorActivity = true;

            signalLater(doc, "cursorActivity", doc);
        }

        function reCheckSelection(cm) {
            setSelection(cm.doc, cm.doc.sel.from, cm.doc.sel.to, null, "push");
        }

        function skipAtomic(doc, pos, bias, mayClear) {
            var flipped = false, curPos = pos;
            var dir = bias || 1;
            doc.cantEdit = false;
            search: for (;;) {
                var line = getLine(doc, curPos.line);
                if (line.markedSpans) {
                    for (var i = 0; i < line.markedSpans.length; ++i) {
                        var sp = line.markedSpans[i], m = sp.marker;
                        if ((sp.from == null || (m.inclusiveLeft ? sp.from <= curPos.ch : sp.from < curPos.ch)) &&
                            (sp.to == null || (m.inclusiveRight ? sp.to >= curPos.ch : sp.to > curPos.ch))) {
                            if (mayClear) {
                                signal(m, "beforeCursorEnter");
                                if (m.explicitlyCleared) {
                                    if (!line.markedSpans) break;
                                    else {--i; continue;}
                                }
                            }
                            if (!m.atomic) continue;
                            var newPos = m.find()[dir < 0 ? "from" : "to"];
                            if (posEq(newPos, curPos)) {
                                newPos.ch += dir;
                                if (newPos.ch < 0) {
                                    if (newPos.line > doc.first) newPos = clipPos(doc, Pos(newPos.line - 1));
                                    else newPos = null;
                                } else if (newPos.ch > line.text.length) {
                                    if (newPos.line < doc.first + doc.size - 1) newPos = Pos(newPos.line + 1, 0);
                                    else newPos = null;
                                }
                                if (!newPos) {
                                    if (flipped) {
                                        // Driven in a corner -- no valid cursor position found at all
                                        // -- try again *with* clearing, if we didn't already
                                        if (!mayClear) return skipAtomic(doc, pos, bias, true);
                                        // Otherwise, turn off editing until further notice, and return the start of the doc
                                        doc.cantEdit = true;
                                        return Pos(doc.first, 0);
                                    }
                                    flipped = true; newPos = pos; dir = -dir;
                                }
                            }
                            curPos = newPos;
                            continue search;
                        }
                    }
                }
                return curPos;
            }
        }

        // SCROLLING

        function scrollCursorIntoView(cm) {
            var coords = scrollPosIntoView(cm, cm.doc.sel.head, cm.options.cursorScrollMargin);
            if (!cm.state.focused) return;
            var display = cm.display, box = getRect(display.sizer), doScroll = null;
            if (coords.top + box.top < 0) doScroll = true;
            else if (coords.bottom + box.top > (window.innerHeight || document.documentElement.clientHeight)) doScroll = false;
            if (doScroll != null && !phantom) {
                var hidden = display.cursor.style.display == "none";
                if (hidden) {
                    display.cursor.style.display = "";
                    display.cursor.style.left = coords.left + "px";
                    display.cursor.style.top = (coords.top - display.viewOffset) + "px";
                }
                display.cursor.scrollIntoView(doScroll);
                if (hidden) display.cursor.style.display = "none";
            }
        }

        function scrollPosIntoView(cm, pos, margin) {
            if (margin == null) margin = 0;
            for (;;) {
                var changed = false, coords = cursorCoords(cm, pos);
                var scrollPos = calculateScrollPos(cm, coords.left, coords.top - margin, coords.left, coords.bottom + margin);
                var startTop = cm.doc.scrollTop, startLeft = cm.doc.scrollLeft;
                if (scrollPos.scrollTop != null) {
                    setScrollTop(cm, scrollPos.scrollTop);
                    if (Math.abs(cm.doc.scrollTop - startTop) > 1) changed = true;
                }
                if (scrollPos.scrollLeft != null) {
                    setScrollLeft(cm, scrollPos.scrollLeft);
                    if (Math.abs(cm.doc.scrollLeft - startLeft) > 1) changed = true;
                }
                if (!changed) return coords;
            }
        }

        function scrollIntoView(cm, x1, y1, x2, y2) {
            var scrollPos = calculateScrollPos(cm, x1, y1, x2, y2);
            if (scrollPos.scrollTop != null) setScrollTop(cm, scrollPos.scrollTop);
            if (scrollPos.scrollLeft != null) setScrollLeft(cm, scrollPos.scrollLeft);
        }

        function calculateScrollPos(cm, x1, y1, x2, y2) {
            var display = cm.display, snapMargin = textHeight(cm.display);
            if (y1 < 0) y1 = 0;
            var screen = display.scroller.clientHeight - scrollerCutOff, screentop = display.scroller.scrollTop, result = {};
            var docBottom = cm.doc.height + paddingVert(display);
            var atTop = y1 < snapMargin, atBottom = y2 > docBottom - snapMargin;
            if (y1 < screentop) {
                result.scrollTop = atTop ? 0 : y1;
            } else if (y2 > screentop + screen) {
                var newTop = Math.min(y1, (atBottom ? docBottom : y2) - screen);
                if (newTop != screentop) result.scrollTop = newTop;
            }

            var screenw = display.scroller.clientWidth - scrollerCutOff, screenleft = display.scroller.scrollLeft;
            x1 += display.gutters.offsetWidth; x2 += display.gutters.offsetWidth;
            var gutterw = display.gutters.offsetWidth;
            var atLeft = x1 < gutterw + 10;
            if (x1 < screenleft + gutterw || atLeft) {
                if (atLeft) x1 = 0;
                result.scrollLeft = Math.max(0, x1 - 10 - gutterw);
            } else if (x2 > screenw + screenleft - 3) {
                result.scrollLeft = x2 + 10 - screenw;
            }
            return result;
        }

        function updateScrollPos(cm, left, top) {
            cm.curOp.updateScrollPos = {scrollLeft: left == null ? cm.doc.scrollLeft : left,
                scrollTop: top == null ? cm.doc.scrollTop : top};
        }

        function addToScrollPos(cm, left, top) {
            var pos = cm.curOp.updateScrollPos || (cm.curOp.updateScrollPos = {scrollLeft: cm.doc.scrollLeft, scrollTop: cm.doc.scrollTop});
            var scroll = cm.display.scroller;
            pos.scrollTop = Math.max(0, Math.min(scroll.scrollHeight - scroll.clientHeight, pos.scrollTop + top));
            pos.scrollLeft = Math.max(0, Math.min(scroll.scrollWidth - scroll.clientWidth, pos.scrollLeft + left));
        }

        // API UTILITIES

        function indentLine(cm, n, how, aggressive) {
            var doc = cm.doc;
            if (how == null) how = "add";
            if (how == "smart") {
                if (!cm.doc.mode.indent) how = "prev";
                else var state = getStateBefore(cm, n);
            }

            var tabSize = cm.options.tabSize;
            var line = getLine(doc, n), curSpace = countColumn(line.text, null, tabSize);
            var curSpaceString = line.text.match(/^\s*/)[0], indentation;
            if (how == "smart") {
                indentation = cm.doc.mode.indent(state, line.text.slice(curSpaceString.length), line.text);
                if (indentation == Pass) {
                    if (!aggressive) return;
                    how = "prev";
                }
            }
            if (how == "prev") {
                if (n > doc.first) indentation = countColumn(getLine(doc, n-1).text, null, tabSize);
                else indentation = 0;
            } else if (how == "add") {
                indentation = curSpace + cm.options.indentUnit;
            } else if (how == "subtract") {
                indentation = curSpace - cm.options.indentUnit;
            } else if (typeof how == "number") {
                indentation = curSpace + how;
            }
            indentation = Math.max(0, indentation);

            var indentString = "", pos = 0;
            if (cm.options.indentWithTabs)
                for (var i = Math.floor(indentation / tabSize); i; --i) {pos += tabSize; indentString += "\t";}
            if (pos < indentation) indentString += spaceStr(indentation - pos);

            if (indentString != curSpaceString)
                replaceRange(cm.doc, indentString, Pos(n, 0), Pos(n, curSpaceString.length), "+input");
            line.stateAfter = null;
        }

        function changeLine(cm, handle, op) {
            var no = handle, line = handle, doc = cm.doc;
            if (typeof handle == "number") line = getLine(doc, clipLine(doc, handle));
            else no = lineNo(handle);
            if (no == null) return null;
            if (op(line, no)) regChange(cm, no, no + 1);
            else return null;
            return line;
        }

        function findPosH(doc, pos, dir, unit, visually) {
            var line = pos.line, ch = pos.ch, origDir = dir;
            var lineObj = getLine(doc, line);
            var possible = true;
            function findNextLine() {
                var l = line + dir;
                if (l < doc.first || l >= doc.first + doc.size) return (possible = false);
                line = l;
                return lineObj = getLine(doc, l);
            }
            function moveOnce(boundToLine) {
                var next = (visually ? moveVisually : moveLogically)(lineObj, ch, dir, true);
                if (next == null) {
                    if (!boundToLine && findNextLine()) {
                        if (visually) ch = (dir < 0 ? lineRight : lineLeft)(lineObj);
                        else ch = dir < 0 ? lineObj.text.length : 0;
                    } else return (possible = false);
                } else ch = next;
                return true;
            }

            if (unit == "char") moveOnce();
            else if (unit == "column") moveOnce(true);
            else if (unit == "word" || unit == "group") {
                var sawType = null, group = unit == "group";
                for (var first = true;; first = false) {
                    if (dir < 0 && !moveOnce(!first)) break;
                    var cur = lineObj.text.charAt(ch) || "\n";
                    var type = isWordChar(cur) ? "w"
                        : !group ? null
                        : /\s/.test(cur) ? null
                        : "p";
                    if (sawType && sawType != type) {
                        if (dir < 0) {dir = 1; moveOnce();}
                        break;
                    }
                    if (type) sawType = type;
                    if (dir > 0 && !moveOnce(!first)) break;
                }
            }
            var result = skipAtomic(doc, Pos(line, ch), origDir, true);
            if (!possible) result.hitSide = true;
            return result;
        }

        function findPosV(cm, pos, dir, unit) {
            var doc = cm.doc, x = pos.left, y;
            if (unit == "page") {
                var pageSize = Math.min(cm.display.wrapper.clientHeight, window.innerHeight || document.documentElement.clientHeight);
                y = pos.top + dir * (pageSize - (dir < 0 ? 1.5 : .5) * textHeight(cm.display));
            } else if (unit == "line") {
                y = dir > 0 ? pos.bottom + 3 : pos.top - 3;
            }
            for (;;) {
                var target = coordsChar(cm, x, y);
                if (!target.outside) break;
                if (dir < 0 ? y <= 0 : y >= doc.height) { target.hitSide = true; break; }
                y += dir * 5;
            }
            return target;
        }

        function findWordAt(line, pos) {
            var start = pos.ch, end = pos.ch;
            if (line) {
                if ((pos.xRel < 0 || end == line.length) && start) --start; else ++end;
                var startChar = line.charAt(start);
                var check = isWordChar(startChar) ? isWordChar
                    : /\s/.test(startChar) ? function(ch) {return /\s/.test(ch);}
                    : function(ch) {return !/\s/.test(ch) && !isWordChar(ch);};
                while (start > 0 && check(line.charAt(start - 1))) --start;
                while (end < line.length && check(line.charAt(end))) ++end;
            }
            return {from: Pos(pos.line, start), to: Pos(pos.line, end)};
        }

        function selectLine(cm, line) {
            extendSelection(cm.doc, Pos(line, 0), clipPos(cm.doc, Pos(line + 1, 0)));
        }

        // PROTOTYPE

        // The publicly visible API. Note that operation(null, f) means
        // 'wrap f in an operation, performed on its `this` parameter'

        CodeMirror.prototype = {
            constructor: CodeMirror,
            focus: function(){window.focus(); focusInput(this); onFocus(this); fastPoll(this);},

            setOption: function(option, value) {
                var options = this.options, old = options[option];
                if (options[option] == value && option != "mode") return;
                options[option] = value;
                if (optionHandlers.hasOwnProperty(option))
                    operation(this, optionHandlers[option])(this, value, old);
            },

            getOption: function(option) {return this.options[option];},
            getDoc: function() {return this.doc;},

            addKeyMap: function(map, bottom) {
                this.state.keyMaps[bottom ? "push" : "unshift"](map);
            },
            removeKeyMap: function(map) {
                var maps = this.state.keyMaps;
                for (var i = 0; i < maps.length; ++i)
                    if (maps[i] == map || (typeof maps[i] != "string" && maps[i].name == map)) {
                        maps.splice(i, 1);
                        return true;
                    }
            },

            addOverlay: operation(null, function(spec, options) {
                var mode = spec.token ? spec : CodeMirror.getMode(this.options, spec);
                if (mode.startState) throw new Error("Overlays may not be stateful.");
                this.state.overlays.push({mode: mode, modeSpec: spec, opaque: options && options.opaque});
                this.state.modeGen++;
                regChange(this);
            }),
            removeOverlay: operation(null, function(spec) {
                var overlays = this.state.overlays;
                for (var i = 0; i < overlays.length; ++i) {
                    var cur = overlays[i].modeSpec;
                    if (cur == spec || typeof spec == "string" && cur.name == spec) {
                        overlays.splice(i, 1);
                        this.state.modeGen++;
                        regChange(this);
                        return;
                    }
                }
            }),

            indentLine: operation(null, function(n, dir, aggressive) {
                if (typeof dir != "string" && typeof dir != "number") {
                    if (dir == null) dir = this.options.smartIndent ? "smart" : "prev";
                    else dir = dir ? "add" : "subtract";
                }
                if (isLine(this.doc, n)) indentLine(this, n, dir, aggressive);
            }),
            indentSelection: operation(null, function(how) {
                var sel = this.doc.sel;
                if (posEq(sel.from, sel.to)) return indentLine(this, sel.from.line, how);
                var e = sel.to.line - (sel.to.ch ? 0 : 1);
                for (var i = sel.from.line; i <= e; ++i) indentLine(this, i, how);
            }),

            // Fetch the parser token for a given character. Useful for hacks
            // that want to inspect the mode state (say, for completion).
            getTokenAt: function(pos, precise) {
                var doc = this.doc;
                pos = clipPos(doc, pos);
                var state = getStateBefore(this, pos.line, precise), mode = this.doc.mode;
                var line = getLine(doc, pos.line);
                var stream = new StringStream(line.text, this.options.tabSize);
                while (stream.pos < pos.ch && !stream.eol()) {
                    stream.start = stream.pos;
                    var style = mode.token(stream, state);
                }
                return {start: stream.start,
                    end: stream.pos,
                    string: stream.current(),
                    className: style || null, // Deprecated, use 'type' instead
                    type: style || null,
                    state: state};
            },

            getTokenTypeAt: function(pos) {
                pos = clipPos(this.doc, pos);
                var styles = getLineStyles(this, getLine(this.doc, pos.line));
                var before = 0, after = (styles.length - 1) / 2, ch = pos.ch;
                if (ch == 0) return styles[2];
                for (;;) {
                    var mid = (before + after) >> 1;
                    if ((mid ? styles[mid * 2 - 1] : 0) >= ch) after = mid;
                    else if (styles[mid * 2 + 1] < ch) before = mid + 1;
                    else return styles[mid * 2 + 2];
                }
            },

            getModeAt: function(pos) {
                var mode = this.doc.mode;
                if (!mode.innerMode) return mode;
                return CodeMirror.innerMode(mode, this.getTokenAt(pos).state).mode;
            },

            getHelper: function(pos, type) {
                if (!helpers.hasOwnProperty(type)) return;
                var help = helpers[type], mode = this.getModeAt(pos);
                return mode[type] && help[mode[type]] ||
                mode.helperType && help[mode.helperType] ||
                help[mode.name];
            },

            getStateAfter: function(line, precise) {
                var doc = this.doc;
                line = clipLine(doc, line == null ? doc.first + doc.size - 1: line);
                return getStateBefore(this, line + 1, precise);
            },

            cursorCoords: function(start, mode) {
                var pos, sel = this.doc.sel;
                if (start == null) pos = sel.head;
                else if (typeof start == "object") pos = clipPos(this.doc, start);
                else pos = start ? sel.from : sel.to;
                return cursorCoords(this, pos, mode || "page");
            },

            charCoords: function(pos, mode) {
                return charCoords(this, clipPos(this.doc, pos), mode || "page");
            },

            coordsChar: function(coords, mode) {
                coords = fromCoordSystem(this, coords, mode || "page");
                return coordsChar(this, coords.left, coords.top);
            },

            lineAtHeight: function(height, mode) {
                height = fromCoordSystem(this, {top: height, left: 0}, mode || "page").top;
                return lineAtHeight(this.doc, height + this.display.viewOffset);
            },
            heightAtLine: function(line, mode) {
                var end = false, last = this.doc.first + this.doc.size - 1;
                if (line < this.doc.first) line = this.doc.first;
                else if (line > last) { line = last; end = true; }
                var lineObj = getLine(this.doc, line);
                return intoCoordSystem(this, getLine(this.doc, line), {top: 0, left: 0}, mode || "page").top +
                (end ? lineObj.height : 0);
            },

            defaultTextHeight: function() { return textHeight(this.display); },
            defaultCharWidth: function() { return charWidth(this.display); },

            setGutterMarker: operation(null, function(line, gutterID, value) {
                return changeLine(this, line, function(line) {
                    var markers = line.gutterMarkers || (line.gutterMarkers = {});
                    markers[gutterID] = value;
                    if (!value && isEmpty(markers)) line.gutterMarkers = null;
                    return true;
                });
            }),

            clearGutter: operation(null, function(gutterID) {
                var cm = this, doc = cm.doc, i = doc.first;
                doc.iter(function(line) {
                    if (line.gutterMarkers && line.gutterMarkers[gutterID]) {
                        line.gutterMarkers[gutterID] = null;
                        regChange(cm, i, i + 1);
                        if (isEmpty(line.gutterMarkers)) line.gutterMarkers = null;
                    }
                    ++i;
                });
            }),

            addLineClass: operation(null, function(handle, where, cls) {
                return changeLine(this, handle, function(line) {
                    var prop = where == "text" ? "textClass" : where == "background" ? "bgClass" : "wrapClass";
                    if (!line[prop]) line[prop] = cls;
                    else if (new RegExp("(?:^|\\s)" + cls + "(?:$|\\s)").test(line[prop])) return false;
                    else line[prop] += " " + cls;
                    return true;
                });
            }),

            removeLineClass: operation(null, function(handle, where, cls) {
                return changeLine(this, handle, function(line) {
                    var prop = where == "text" ? "textClass" : where == "background" ? "bgClass" : "wrapClass";
                    var cur = line[prop];
                    if (!cur) return false;
                    else if (cls == null) line[prop] = null;
                    else {
                        var found = cur.match(new RegExp("(?:^|\\s+)" + cls + "(?:$|\\s+)"));
                        if (!found) return false;
                        var end = found.index + found[0].length;
                        line[prop] = cur.slice(0, found.index) + (!found.index || end == cur.length ? "" : " ") + cur.slice(end) || null;
                    }
                    return true;
                });
            }),

            addLineWidget: operation(null, function(handle, node, options) {
                return addLineWidget(this, handle, node, options);
            }),

            removeLineWidget: function(widget) { widget.clear(); },

            lineInfo: function(line) {
                if (typeof line == "number") {
                    if (!isLine(this.doc, line)) return null;
                    var n = line;
                    line = getLine(this.doc, line);
                    if (!line) return null;
                } else {
                    var n = lineNo(line);
                    if (n == null) return null;
                }
                return {line: n, handle: line, text: line.text, gutterMarkers: line.gutterMarkers,
                    textClass: line.textClass, bgClass: line.bgClass, wrapClass: line.wrapClass,
                    widgets: line.widgets};
            },

            getViewport: function() { return {from: this.display.showingFrom, to: this.display.showingTo};},

            addWidget: function(pos, node, scroll, vert, horiz) {
                var display = this.display;
                pos = cursorCoords(this, clipPos(this.doc, pos));
                var top = pos.bottom, left = pos.left;
                node.style.position = "absolute";
                display.sizer.appendChild(node);
                if (vert == "over") {
                    top = pos.top;
                } else if (vert == "above" || vert == "near") {
                    var vspace = Math.max(display.wrapper.clientHeight, this.doc.height),
                        hspace = Math.max(display.sizer.clientWidth, display.lineSpace.clientWidth);
                    // Default to positioning above (if specified and possible); otherwise default to positioning below
                    if ((vert == 'above' || pos.bottom + node.offsetHeight > vspace) && pos.top > node.offsetHeight)
                        top = pos.top - node.offsetHeight;
                    else if (pos.bottom + node.offsetHeight <= vspace)
                        top = pos.bottom;
                    if (left + node.offsetWidth > hspace)
                        left = hspace - node.offsetWidth;
                }
                node.style.top = top + "px";
                node.style.left = node.style.right = "";
                if (horiz == "right") {
                    left = display.sizer.clientWidth - node.offsetWidth;
                    node.style.right = "0px";
                } else {
                    if (horiz == "left") left = 0;
                    else if (horiz == "middle") left = (display.sizer.clientWidth - node.offsetWidth) / 2;
                    node.style.left = left + "px";
                }
                if (scroll)
                    scrollIntoView(this, left, top, left + node.offsetWidth, top + node.offsetHeight);
            },

            triggerOnKeyDown: operation(null, onKeyDown),

            execCommand: function(cmd) {return commands[cmd](this);},

            findPosH: function(from, amount, unit, visually) {
                var dir = 1;
                if (amount < 0) { dir = -1; amount = -amount; }
                for (var i = 0, cur = clipPos(this.doc, from); i < amount; ++i) {
                    cur = findPosH(this.doc, cur, dir, unit, visually);
                    if (cur.hitSide) break;
                }
                return cur;
            },

            moveH: operation(null, function(dir, unit) {
                var sel = this.doc.sel, pos;
                if (sel.shift || sel.extend || posEq(sel.from, sel.to))
                    pos = findPosH(this.doc, sel.head, dir, unit, this.options.rtlMoveVisually);
                else
                    pos = dir < 0 ? sel.from : sel.to;
                extendSelection(this.doc, pos, pos, dir);
            }),

            deleteH: operation(null, function(dir, unit) {
                var sel = this.doc.sel;
                if (!posEq(sel.from, sel.to)) replaceRange(this.doc, "", sel.from, sel.to, "+delete");
                else replaceRange(this.doc, "", sel.from, findPosH(this.doc, sel.head, dir, unit, false), "+delete");
                this.curOp.userSelChange = true;
            }),

            findPosV: function(from, amount, unit, goalColumn) {
                var dir = 1, x = goalColumn;
                if (amount < 0) { dir = -1; amount = -amount; }
                for (var i = 0, cur = clipPos(this.doc, from); i < amount; ++i) {
                    var coords = cursorCoords(this, cur, "div");
                    if (x == null) x = coords.left;
                    else coords.left = x;
                    cur = findPosV(this, coords, dir, unit);
                    if (cur.hitSide) break;
                }
                return cur;
            },

            moveV: operation(null, function(dir, unit) {
                var sel = this.doc.sel;
                var pos = cursorCoords(this, sel.head, "div");
                if (sel.goalColumn != null) pos.left = sel.goalColumn;
                var target = findPosV(this, pos, dir, unit);

                if (unit == "page") addToScrollPos(this, 0, charCoords(this, target, "div").top - pos.top);
                extendSelection(this.doc, target, target, dir);
                sel.goalColumn = pos.left;
            }),

            toggleOverwrite: function(value) {
                if (value != null && value == this.state.overwrite) return;
                if (this.state.overwrite = !this.state.overwrite)
                    this.display.cursor.className += " CodeMirror-overwrite";
                else
                    this.display.cursor.className = this.display.cursor.className.replace(" CodeMirror-overwrite", "");
            },
            hasFocus: function() { return this.state.focused; },

            scrollTo: operation(null, function(x, y) {
                updateScrollPos(this, x, y);
            }),
            getScrollInfo: function() {
                var scroller = this.display.scroller, co = scrollerCutOff;
                return {left: scroller.scrollLeft, top: scroller.scrollTop,
                    height: scroller.scrollHeight - co, width: scroller.scrollWidth - co,
                    clientHeight: scroller.clientHeight - co, clientWidth: scroller.clientWidth - co};
            },

            scrollIntoView: operation(null, function(pos, margin) {
                if (typeof pos == "number") pos = Pos(pos, 0);
                if (!margin) margin = 0;
                var coords = pos;

                if (!pos || pos.line != null) {
                    this.curOp.scrollToPos = pos ? clipPos(this.doc, pos) : this.doc.sel.head;
                    this.curOp.scrollToPosMargin = margin;
                    coords = cursorCoords(this, this.curOp.scrollToPos);
                }
                var sPos = calculateScrollPos(this, coords.left, coords.top - margin, coords.right, coords.bottom + margin);
                updateScrollPos(this, sPos.scrollLeft, sPos.scrollTop);
            }),

            setSize: operation(null, function(width, height) {
                function interpret(val) {
                    return typeof val == "number" || /^\d+$/.test(String(val)) ? val + "px" : val;
                }
                if (width != null) this.display.wrapper.style.width = interpret(width);
                if (height != null) this.display.wrapper.style.height = interpret(height);
                if (this.options.lineWrapping)
                    this.display.measureLineCache.length = this.display.measureLineCachePos = 0;
                this.curOp.forceUpdate = true;
            }),

            operation: function(f){return runInOp(this, f);},

            refresh: operation(null, function() {
                clearCaches(this);
                updateScrollPos(this, this.doc.scrollLeft, this.doc.scrollTop);
                regChange(this);
            }),

            swapDoc: operation(null, function(doc) {
                var old = this.doc;
                old.cm = null;
                attachDoc(this, doc);
                clearCaches(this);
                resetInput(this, true);
                updateScrollPos(this, doc.scrollLeft, doc.scrollTop);
                return old;
            }),

            getInputField: function(){return this.display.input;},
            getWrapperElement: function(){return this.display.wrapper;},
            getScrollerElement: function(){return this.display.scroller;},
            getGutterElement: function(){return this.display.gutters;}
        };
        eventMixin(CodeMirror);

        // OPTION DEFAULTS

        var optionHandlers = CodeMirror.optionHandlers = {};

        // The default configuration options.
        var defaults = CodeMirror.defaults = {};

        function option(name, deflt, handle, notOnInit) {
            CodeMirror.defaults[name] = deflt;
            if (handle) optionHandlers[name] =
                notOnInit ? function(cm, val, old) {if (old != Init) handle(cm, val, old);} : handle;
        }

        var Init = CodeMirror.Init = {toString: function(){return "CodeMirror.Init";}};

        // These two are, on init, called from the constructor because they
        // have to be initialized before the editor can start at all.
        option("value", "", function(cm, val) {
            cm.setValue(val);
        }, true);
        option("mode", null, function(cm, val) {
            cm.doc.modeOption = val;
            loadMode(cm);
        }, true);

        option("indentUnit", 2, loadMode, true);
        option("indentWithTabs", false);
        option("smartIndent", true);
        option("tabSize", 4, function(cm) {
            loadMode(cm);
            clearCaches(cm);
            regChange(cm);
        }, true);
        option("electricChars", true);
        option("rtlMoveVisually", !windows);

        option("theme", "default", function(cm) {
            themeChanged(cm);
            guttersChanged(cm);
        }, true);
        option("keyMap", "default", keyMapChanged);
        option("extraKeys", null);

        option("onKeyEvent", null);
        option("onDragEvent", null);

        option("lineWrapping", false, wrappingChanged, true);
        option("gutters", [], function(cm) {
            setGuttersForLineNumbers(cm.options);
            guttersChanged(cm);
        }, true);
        option("fixedGutter", true, function(cm, val) {
            cm.display.gutters.style.left = val ? compensateForHScroll(cm.display) + "px" : "0";
            cm.refresh();
        }, true);
        option("coverGutterNextToScrollbar", false, updateScrollbars, true);
        option("lineNumbers", false, function(cm) {
            setGuttersForLineNumbers(cm.options);
            guttersChanged(cm);
        }, true);
        option("firstLineNumber", 1, guttersChanged, true);
        option("lineNumberFormatter", function(integer) {return integer;}, guttersChanged, true);
        option("showCursorWhenSelecting", false, updateSelection, true);

        option("readOnly", false, function(cm, val) {
            if (val == "nocursor") {onBlur(cm); cm.display.input.blur();}
            else if (!val) resetInput(cm, true);
        });
        option("dragDrop", true);

        option("cursorBlinkRate", 530);
        option("cursorScrollMargin", 0);
        option("cursorHeight", 1);
        option("workTime", 100);
        option("workDelay", 100);
        option("flattenSpans", true);
        option("pollInterval", 100);
        option("undoDepth", 40, function(cm, val){cm.doc.history.undoDepth = val;});
        option("historyEventDelay", 500);
        option("viewportMargin", 10, function(cm){cm.refresh();}, true);
        option("maxHighlightLength", 10000, function(cm){loadMode(cm); cm.refresh();}, true);
        option("moveInputWithCursor", true, function(cm, val) {
            if (!val) cm.display.inputDiv.style.top = cm.display.inputDiv.style.left = 0;
        });

        option("tabindex", null, function(cm, val) {
            cm.display.input.tabIndex = val || "";
        });
        option("autofocus", null);

        // MODE DEFINITION AND QUERYING

        // Known modes, by name and by MIME
        var modes = CodeMirror.modes = {}, mimeModes = CodeMirror.mimeModes = {};

        CodeMirror.defineMode = function(name, mode) {
            if (!CodeMirror.defaults.mode && name != "null") CodeMirror.defaults.mode = name;
            if (arguments.length > 2) {
                mode.dependencies = [];
                for (var i = 2; i < arguments.length; ++i) mode.dependencies.push(arguments[i]);
            }
            modes[name] = mode;
        };

        CodeMirror.defineMIME = function(mime, spec) {
            mimeModes[mime] = spec;
        };

        CodeMirror.resolveMode = function(spec) {
            if (typeof spec == "string" && mimeModes.hasOwnProperty(spec)) {
                spec = mimeModes[spec];
            } else if (spec && typeof spec.name == "string" && mimeModes.hasOwnProperty(spec.name)) {
                var found = mimeModes[spec.name];
                spec = createObj(found, spec);
                spec.name = found.name;
            } else if (typeof spec == "string" && /^[\w\-]+\/[\w\-]+\+xml$/.test(spec)) {
                return CodeMirror.resolveMode("application/xml");
            }
            if (typeof spec == "string") return {name: spec};
            else return spec || {name: "null"};
        };

        CodeMirror.getMode = function(options, spec) {
            var spec = CodeMirror.resolveMode(spec);
            var mfactory = modes[spec.name];
            if (!mfactory) return CodeMirror.getMode(options, "text/plain");
            var modeObj = mfactory(options, spec);
            if (modeExtensions.hasOwnProperty(spec.name)) {
                var exts = modeExtensions[spec.name];
                for (var prop in exts) {
                    if (!exts.hasOwnProperty(prop)) continue;
                    if (modeObj.hasOwnProperty(prop)) modeObj["_" + prop] = modeObj[prop];
                    modeObj[prop] = exts[prop];
                }
            }
            modeObj.name = spec.name;

            return modeObj;
        };

        CodeMirror.defineMode("null", function() {
            return {token: function(stream) {stream.skipToEnd();}};
        });
        CodeMirror.defineMIME("text/plain", "null");

        var modeExtensions = CodeMirror.modeExtensions = {};
        CodeMirror.extendMode = function(mode, properties) {
            var exts = modeExtensions.hasOwnProperty(mode) ? modeExtensions[mode] : (modeExtensions[mode] = {});
            copyObj(properties, exts);
        };

        // EXTENSIONS

        CodeMirror.defineExtension = function(name, func) {
            CodeMirror.prototype[name] = func;
        };
        CodeMirror.defineDocExtension = function(name, func) {
            Doc.prototype[name] = func;
        };
        CodeMirror.defineOption = option;

        var initHooks = [];
        CodeMirror.defineInitHook = function(f) {initHooks.push(f);};

        var helpers = CodeMirror.helpers = {};
        CodeMirror.registerHelper = function(type, name, value) {
            if (!helpers.hasOwnProperty(type)) helpers[type] = CodeMirror[type] = {};
            helpers[type][name] = value;
        };

        // UTILITIES

        CodeMirror.isWordChar = isWordChar;

        // MODE STATE HANDLING

        // Utility functions for working with state. Exported because modes
        // sometimes need to do this.
        function copyState(mode, state) {
            if (state === true) return state;
            if (mode.copyState) return mode.copyState(state);
            var nstate = {};
            for (var n in state) {
                var val = state[n];
                if (val instanceof Array) val = val.concat([]);
                nstate[n] = val;
            }
            return nstate;
        }
        CodeMirror.copyState = copyState;

        function startState(mode, a1, a2) {
            return mode.startState ? mode.startState(a1, a2) : true;
        }
        CodeMirror.startState = startState;

        CodeMirror.innerMode = function(mode, state) {
            while (mode.innerMode) {
                var info = mode.innerMode(state);
                if (!info || info.mode == mode) break;
                state = info.state;
                mode = info.mode;
            }
            return info || {mode: mode, state: state};
        };

        // STANDARD COMMANDS

        var commands = CodeMirror.commands = {
            selectAll: function(cm) {cm.setSelection(Pos(cm.firstLine(), 0), Pos(cm.lastLine()));},
            killLine: function(cm) {
                var from = cm.getCursor(true), to = cm.getCursor(false), sel = !posEq(from, to);
                if (!sel && cm.getLine(from.line).length == from.ch)
                    cm.replaceRange("", from, Pos(from.line + 1, 0), "+delete");
                else cm.replaceRange("", from, sel ? to : Pos(from.line), "+delete");
            },
            deleteLine: function(cm) {
                var l = cm.getCursor().line;
                cm.replaceRange("", Pos(l, 0), Pos(l), "+delete");
            },
            delLineLeft: function(cm) {
                var cur = cm.getCursor();
                cm.replaceRange("", Pos(cur.line, 0), cur, "+delete");
            },
            undo: function(cm) {cm.undo();},
            redo: function(cm) {cm.redo();},
            goDocStart: function(cm) {cm.extendSelection(Pos(cm.firstLine(), 0));},
            goDocEnd: function(cm) {cm.extendSelection(Pos(cm.lastLine()));},
            goLineStart: function(cm) {
                cm.extendSelection(lineStart(cm, cm.getCursor().line));
            },
            goLineStartSmart: function(cm) {
                var cur = cm.getCursor(), start = lineStart(cm, cur.line);
                var line = cm.getLineHandle(start.line);
                var order = getOrder(line);
                if (!order || order[0].level == 0) {
                    var firstNonWS = Math.max(0, line.text.search(/\S/));
                    var inWS = cur.line == start.line && cur.ch <= firstNonWS && cur.ch;
                    cm.extendSelection(Pos(start.line, inWS ? 0 : firstNonWS));
                } else cm.extendSelection(start);
            },
            goLineEnd: function(cm) {
                cm.extendSelection(lineEnd(cm, cm.getCursor().line));
            },
            goLineRight: function(cm) {
                var top = cm.charCoords(cm.getCursor(), "div").top + 5;
                cm.extendSelection(cm.coordsChar({left: cm.display.lineDiv.offsetWidth + 100, top: top}, "div"));
            },
            goLineLeft: function(cm) {
                var top = cm.charCoords(cm.getCursor(), "div").top + 5;
                cm.extendSelection(cm.coordsChar({left: 0, top: top}, "div"));
            },
            goLineUp: function(cm) {cm.moveV(-1, "line");},
            goLineDown: function(cm) {cm.moveV(1, "line");},
            goPageUp: function(cm) {cm.moveV(-1, "page");},
            goPageDown: function(cm) {cm.moveV(1, "page");},
            goCharLeft: function(cm) {cm.moveH(-1, "char");},
            goCharRight: function(cm) {cm.moveH(1, "char");},
            goColumnLeft: function(cm) {cm.moveH(-1, "column");},
            goColumnRight: function(cm) {cm.moveH(1, "column");},
            goWordLeft: function(cm) {cm.moveH(-1, "word");},
            goGroupRight: function(cm) {cm.moveH(1, "group");},
            goGroupLeft: function(cm) {cm.moveH(-1, "group");},
            goWordRight: function(cm) {cm.moveH(1, "word");},
            delCharBefore: function(cm) {cm.deleteH(-1, "char");},
            delCharAfter: function(cm) {cm.deleteH(1, "char");},
            delWordBefore: function(cm) {cm.deleteH(-1, "word");},
            delWordAfter: function(cm) {cm.deleteH(1, "word");},
            delGroupBefore: function(cm) {cm.deleteH(-1, "group");},
            delGroupAfter: function(cm) {cm.deleteH(1, "group");},
            indentAuto: function(cm) {cm.indentSelection("smart");},
            indentMore: function(cm) {cm.indentSelection("add");},
            indentLess: function(cm) {cm.indentSelection("subtract");},
            insertTab: function(cm) {cm.replaceSelection("\t", "end", "+input");},
            defaultTab: function(cm) {
                if (cm.somethingSelected()) cm.indentSelection("add");
                else cm.replaceSelection("\t", "end", "+input");
            },
            transposeChars: function(cm) {
                var cur = cm.getCursor(), line = cm.getLine(cur.line);
                if (cur.ch > 0 && cur.ch < line.length - 1)
                    cm.replaceRange(line.charAt(cur.ch) + line.charAt(cur.ch - 1),
                        Pos(cur.line, cur.ch - 1), Pos(cur.line, cur.ch + 1));
            },
            newlineAndIndent: function(cm) {
                operation(cm, function() {
                    cm.replaceSelection("\n", "end", "+input");
                    cm.indentLine(cm.getCursor().line, null, true);
                })();
            },
            toggleOverwrite: function(cm) {cm.toggleOverwrite();}
        };

        // STANDARD KEYMAPS

        var keyMap = CodeMirror.keyMap = {};
        keyMap.basic = {
            "Left": "goCharLeft", "Right": "goCharRight", "Up": "goLineUp", "Down": "goLineDown",
            "End": "goLineEnd", "Home": "goLineStartSmart", "PageUp": "goPageUp", "PageDown": "goPageDown",
            "Delete": "delCharAfter", "Backspace": "delCharBefore", "Tab": "defaultTab", "Shift-Tab": "indentAuto",
            "Enter": "newlineAndIndent", "Insert": "toggleOverwrite"
        };
        // Note that the save and find-related commands aren't defined by
        // default. Unknown commands are simply ignored.
        keyMap.pcDefault = {
            "Ctrl-A": "selectAll", "Ctrl-D": "deleteLine", "Ctrl-Z": "undo", "Shift-Ctrl-Z": "redo", "Ctrl-Y": "redo",
            "Ctrl-Home": "goDocStart", "Alt-Up": "goDocStart", "Ctrl-End": "goDocEnd", "Ctrl-Down": "goDocEnd",
            "Ctrl-Left": "goGroupLeft", "Ctrl-Right": "goGroupRight", "Alt-Left": "goLineStart", "Alt-Right": "goLineEnd",
            "Ctrl-Backspace": "delGroupBefore", "Ctrl-Delete": "delGroupAfter", "Ctrl-S": "save", "Ctrl-F": "find",
            "Ctrl-G": "findNext", "Shift-Ctrl-G": "findPrev", "Shift-Ctrl-F": "replace", "Shift-Ctrl-R": "replaceAll",
            "Ctrl-[": "indentLess", "Ctrl-]": "indentMore",
            fallthrough: "basic"
        };
        keyMap.macDefault = {
            "Cmd-A": "selectAll", "Cmd-D": "deleteLine", "Cmd-Z": "undo", "Shift-Cmd-Z": "redo", "Cmd-Y": "redo",
            "Cmd-Up": "goDocStart", "Cmd-End": "goDocEnd", "Cmd-Down": "goDocEnd", "Alt-Left": "goGroupLeft",
            "Alt-Right": "goGroupRight", "Cmd-Left": "goLineStart", "Cmd-Right": "goLineEnd", "Alt-Backspace": "delGroupBefore",
            "Ctrl-Alt-Backspace": "delGroupAfter", "Alt-Delete": "delGroupAfter", "Cmd-S": "save", "Cmd-F": "find",
            "Cmd-G": "findNext", "Shift-Cmd-G": "findPrev", "Cmd-Alt-F": "replace", "Shift-Cmd-Alt-F": "replaceAll",
            "Cmd-[": "indentLess", "Cmd-]": "indentMore", "Cmd-Backspace": "delLineLeft",
            fallthrough: ["basic", "emacsy"]
        };
        keyMap["default"] = mac ? keyMap.macDefault : keyMap.pcDefault;
        keyMap.emacsy = {
            "Ctrl-F": "goCharRight", "Ctrl-B": "goCharLeft", "Ctrl-P": "goLineUp", "Ctrl-N": "goLineDown",
            "Alt-F": "goWordRight", "Alt-B": "goWordLeft", "Ctrl-A": "goLineStart", "Ctrl-E": "goLineEnd",
            "Ctrl-V": "goPageDown", "Shift-Ctrl-V": "goPageUp", "Ctrl-D": "delCharAfter", "Ctrl-H": "delCharBefore",
            "Alt-D": "delWordAfter", "Alt-Backspace": "delWordBefore", "Ctrl-K": "killLine", "Ctrl-T": "transposeChars"
        };

        // KEYMAP DISPATCH

        function getKeyMap(val) {
            if (typeof val == "string") return keyMap[val];
            else return val;
        }

        function lookupKey(name, maps, handle) {
            function lookup(map) {
                map = getKeyMap(map);
                var found = map[name];
                if (found === false) return "stop";
                if (found != null && handle(found)) return true;
                if (map.nofallthrough) return "stop";

                var fallthrough = map.fallthrough;
                if (fallthrough == null) return false;
                if (Object.prototype.toString.call(fallthrough) != "[object Array]")
                    return lookup(fallthrough);
                for (var i = 0, e = fallthrough.length; i < e; ++i) {
                    var done = lookup(fallthrough[i]);
                    if (done) return done;
                }
                return false;
            }

            for (var i = 0; i < maps.length; ++i) {
                var done = lookup(maps[i]);
                if (done) return done != "stop";
            }
        }
        function isModifierKey(event) {
            var name = keyNames[event.keyCode];
            return name == "Ctrl" || name == "Alt" || name == "Shift" || name == "Mod";
        }
        function keyName(event, noShift) {
            if (opera && event.keyCode == 34 && event["char"]) return false;
            var name = keyNames[event.keyCode];
            if (name == null || event.altGraphKey) return false;
            if (event.altKey) name = "Alt-" + name;
            if (flipCtrlCmd ? event.metaKey : event.ctrlKey) name = "Ctrl-" + name;
            if (flipCtrlCmd ? event.ctrlKey : event.metaKey) name = "Cmd-" + name;
            if (!noShift && event.shiftKey) name = "Shift-" + name;
            return name;
        }
        CodeMirror.lookupKey = lookupKey;
        CodeMirror.isModifierKey = isModifierKey;
        CodeMirror.keyName = keyName;

        // FROMTEXTAREA

        CodeMirror.fromTextArea = function(textarea, options) {
            if (!options) options = {};
            options.value = textarea.value;
            if (!options.tabindex && textarea.tabindex)
                options.tabindex = textarea.tabindex;
            if (!options.placeholder && textarea.placeholder)
                options.placeholder = textarea.placeholder;
            // Set autofocus to true if this textarea is focused, or if it has
            // autofocus and no other element is focused.
            if (options.autofocus == null) {
                var hasFocus = document.body;
                // doc.activeElement occasionally throws on IE
                try { hasFocus = document.activeElement; } catch(e) {}
                options.autofocus = hasFocus == textarea ||
                textarea.getAttribute("autofocus") != null && hasFocus == document.body;
            }

            function save() {textarea.value = cm.getValue();}
            if (textarea.form) {
                on(textarea.form, "submit", save);
                // Deplorable hack to make the submit method do the right thing.
                if (!options.leaveSubmitMethodAlone) {
                    var form = textarea.form, realSubmit = form.submit;
                    try {
                        var wrappedSubmit = form.submit = function() {
                            save();
                            form.submit = realSubmit;
                            form.submit();
                            form.submit = wrappedSubmit;
                        };
                    } catch(e) {}
                }
            }

            textarea.style.display = "none";
            var cm = CodeMirror(function(node) {
                textarea.parentNode.insertBefore(node, textarea.nextSibling);
            }, options);
            cm.save = save;
            cm.getTextArea = function() { return textarea; };
            cm.toTextArea = function() {
                save();
                textarea.parentNode.removeChild(cm.getWrapperElement());
                textarea.style.display = "";
                if (textarea.form) {
                    off(textarea.form, "submit", save);
                    if (typeof textarea.form.submit == "function")
                        textarea.form.submit = realSubmit;
                }
            };
            return cm;
        };

        // STRING STREAM

        // Fed to the mode parsers, provides helper functions to make
        // parsers more succinct.

        // The character stream used by a mode's parser.
        function StringStream(string, tabSize) {
            this.pos = this.start = 0;
            this.string = string;
            this.tabSize = tabSize || 8;
            this.lastColumnPos = this.lastColumnValue = 0;
        }

        StringStream.prototype = {
            eol: function() {return this.pos >= this.string.length;},
            sol: function() {return this.pos == 0;},
            peek: function() {return this.string.charAt(this.pos) || undefined;},
            next: function() {
                if (this.pos < this.string.length)
                    return this.string.charAt(this.pos++);
            },
            eat: function(match) {
                var ch = this.string.charAt(this.pos);
                if (typeof match == "string") var ok = ch == match;
                else var ok = ch && (match.test ? match.test(ch) : match(ch));
                if (ok) {++this.pos; return ch;}
            },
            eatWhile: function(match) {
                var start = this.pos;
                while (this.eat(match)){}
                return this.pos > start;
            },
            eatSpace: function() {
                var start = this.pos;
                while (/[\s\u00a0]/.test(this.string.charAt(this.pos))) ++this.pos;
                return this.pos > start;
            },
            skipToEnd: function() {this.pos = this.string.length;},
            skipTo: function(ch) {
                var found = this.string.indexOf(ch, this.pos);
                if (found > -1) {this.pos = found; return true;}
            },
            backUp: function(n) {this.pos -= n;},
            column: function() {
                if (this.lastColumnPos < this.start) {
                    this.lastColumnValue = countColumn(this.string, this.start, this.tabSize, this.lastColumnPos, this.lastColumnValue);
                    this.lastColumnPos = this.start;
                }
                return this.lastColumnValue;
            },
            indentation: function() {return countColumn(this.string, null, this.tabSize);},
            match: function(pattern, consume, caseInsensitive) {
                if (typeof pattern == "string") {
                    var cased = function(str) {return caseInsensitive ? str.toLowerCase() : str;};
                    var substr = this.string.substr(this.pos, pattern.length);
                    if (cased(substr) == cased(pattern)) {
                        if (consume !== false) this.pos += pattern.length;
                        return true;
                    }
                } else {
                    var match = this.string.slice(this.pos).match(pattern);
                    if (match && match.index > 0) return null;
                    if (match && consume !== false) this.pos += match[0].length;
                    return match;
                }
            },
            current: function(){return this.string.slice(this.start, this.pos);}
        };
        CodeMirror.StringStream = StringStream;

        // TEXTMARKERS

        function TextMarker(doc, type) {
            this.lines = [];
            this.type = type;
            this.doc = doc;
        }
        CodeMirror.TextMarker = TextMarker;
        eventMixin(TextMarker);

        TextMarker.prototype.clear = function() {
            if (this.explicitlyCleared) return;
            var cm = this.doc.cm, withOp = cm && !cm.curOp;
            if (withOp) startOperation(cm);
            if (hasHandler(this, "clear")) {
                var found = this.find();
                if (found) signalLater(this, "clear", found.from, found.to);
            }
            var min = null, max = null;
            for (var i = 0; i < this.lines.length; ++i) {
                var line = this.lines[i];
                var span = getMarkedSpanFor(line.markedSpans, this);
                if (span.to != null) max = lineNo(line);
                line.markedSpans = removeMarkedSpan(line.markedSpans, span);
                if (span.from != null)
                    min = lineNo(line);
                else if (this.collapsed && !lineIsHidden(this.doc, line) && cm)
                    updateLineHeight(line, textHeight(cm.display));
            }
            if (cm && this.collapsed && !cm.options.lineWrapping) for (var i = 0; i < this.lines.length; ++i) {
                var visual = visualLine(cm.doc, this.lines[i]), len = lineLength(cm.doc, visual);
                if (len > cm.display.maxLineLength) {
                    cm.display.maxLine = visual;
                    cm.display.maxLineLength = len;
                    cm.display.maxLineChanged = true;
                }
            }

            if (min != null && cm) regChange(cm, min, max + 1);
            this.lines.length = 0;
            this.explicitlyCleared = true;
            if (this.atomic && this.doc.cantEdit) {
                this.doc.cantEdit = false;
                if (cm) reCheckSelection(cm);
            }
            if (withOp) endOperation(cm);
        };

        TextMarker.prototype.find = function() {
            var from, to;
            for (var i = 0; i < this.lines.length; ++i) {
                var line = this.lines[i];
                var span = getMarkedSpanFor(line.markedSpans, this);
                if (span.from != null || span.to != null) {
                    var found = lineNo(line);
                    if (span.from != null) from = Pos(found, span.from);
                    if (span.to != null) to = Pos(found, span.to);
                }
            }
            if (this.type == "bookmark") return from;
            return from && {from: from, to: to};
        };

        TextMarker.prototype.changed = function() {
            var pos = this.find(), cm = this.doc.cm;
            if (!pos || !cm) return;
            var line = getLine(this.doc, pos.from.line);
            clearCachedMeasurement(cm, line);
            if (pos.from.line >= cm.display.showingFrom && pos.from.line < cm.display.showingTo) {
                for (var node = cm.display.lineDiv.firstChild; node; node = node.nextSibling) if (node.lineObj == line) {
                    if (node.offsetHeight != line.height) updateLineHeight(line, node.offsetHeight);
                    break;
                }
                runInOp(cm, function() {
                    cm.curOp.selectionChanged = cm.curOp.forceUpdate = cm.curOp.updateMaxLine = true;
                });
            }
        };

        TextMarker.prototype.attachLine = function(line) {
            if (!this.lines.length && this.doc.cm) {
                var op = this.doc.cm.curOp;
                if (!op.maybeHiddenMarkers || indexOf(op.maybeHiddenMarkers, this) == -1)
                    (op.maybeUnhiddenMarkers || (op.maybeUnhiddenMarkers = [])).push(this);
            }
            this.lines.push(line);
        };
        TextMarker.prototype.detachLine = function(line) {
            this.lines.splice(indexOf(this.lines, line), 1);
            if (!this.lines.length && this.doc.cm) {
                var op = this.doc.cm.curOp;
                (op.maybeHiddenMarkers || (op.maybeHiddenMarkers = [])).push(this);
            }
        };

        function markText(doc, from, to, options, type) {
            if (options && options.shared) return markTextShared(doc, from, to, options, type);
            if (doc.cm && !doc.cm.curOp) return operation(doc.cm, markText)(doc, from, to, options, type);

            var marker = new TextMarker(doc, type);
            if (type == "range" && !posLess(from, to)) return marker;
            if (options) copyObj(options, marker);
            if (marker.replacedWith) {
                marker.collapsed = true;
                marker.replacedWith = elt("span", [marker.replacedWith], "CodeMirror-widget");
                if (!options.handleMouseEvents) marker.replacedWith.ignoreEvents = true;
            }
            if (marker.collapsed) sawCollapsedSpans = true;

            if (marker.addToHistory)
                addToHistory(doc, {from: from, to: to, origin: "markText"},
                    {head: doc.sel.head, anchor: doc.sel.anchor}, NaN);

            var curLine = from.line, size = 0, collapsedAtStart, collapsedAtEnd, cm = doc.cm, updateMaxLine;
            doc.iter(curLine, to.line + 1, function(line) {
                if (cm && marker.collapsed && !cm.options.lineWrapping && visualLine(doc, line) == cm.display.maxLine)
                    updateMaxLine = true;
                var span = {from: null, to: null, marker: marker};
                size += line.text.length;
                if (curLine == from.line) {span.from = from.ch; size -= from.ch;}
                if (curLine == to.line) {span.to = to.ch; size -= line.text.length - to.ch;}
                if (marker.collapsed) {
                    if (curLine == to.line) collapsedAtEnd = collapsedSpanAt(line, to.ch);
                    if (curLine == from.line) collapsedAtStart = collapsedSpanAt(line, from.ch);
                    else updateLineHeight(line, 0);
                }
                addMarkedSpan(line, span);
                ++curLine;
            });
            if (marker.collapsed) doc.iter(from.line, to.line + 1, function(line) {
                if (lineIsHidden(doc, line)) updateLineHeight(line, 0);
            });

            if (marker.clearOnEnter) on(marker, "beforeCursorEnter", function() { marker.clear(); });

            if (marker.readOnly) {
                sawReadOnlySpans = true;
                if (doc.history.done.length || doc.history.undone.length)
                    doc.clearHistory();
            }
            if (marker.collapsed) {
                if (collapsedAtStart != collapsedAtEnd)
                    throw new Error("Inserting collapsed marker overlapping an existing one");
                marker.size = size;
                marker.atomic = true;
            }
            if (cm) {
                if (updateMaxLine) cm.curOp.updateMaxLine = true;
                if (marker.className || marker.title || marker.startStyle || marker.endStyle || marker.collapsed)
                    regChange(cm, from.line, to.line + 1);
                if (marker.atomic) reCheckSelection(cm);
            }
            return marker;
        }

        // SHARED TEXTMARKERS

        function SharedTextMarker(markers, primary) {
            this.markers = markers;
            this.primary = primary;
            for (var i = 0, me = this; i < markers.length; ++i) {
                markers[i].parent = this;
                on(markers[i], "clear", function(){me.clear();});
            }
        }
        CodeMirror.SharedTextMarker = SharedTextMarker;
        eventMixin(SharedTextMarker);

        SharedTextMarker.prototype.clear = function() {
            if (this.explicitlyCleared) return;
            this.explicitlyCleared = true;
            for (var i = 0; i < this.markers.length; ++i)
                this.markers[i].clear();
            signalLater(this, "clear");
        };
        SharedTextMarker.prototype.find = function() {
            return this.primary.find();
        };

        function markTextShared(doc, from, to, options, type) {
            options = copyObj(options);
            options.shared = false;
            var markers = [markText(doc, from, to, options, type)], primary = markers[0];
            var widget = options.replacedWith;
            linkedDocs(doc, function(doc) {
                if (widget) options.replacedWith = widget.cloneNode(true);
                markers.push(markText(doc, clipPos(doc, from), clipPos(doc, to), options, type));
                for (var i = 0; i < doc.linked.length; ++i)
                    if (doc.linked[i].isParent) return;
                primary = lst(markers);
            });
            return new SharedTextMarker(markers, primary);
        }

        // TEXTMARKER SPANS

        function getMarkedSpanFor(spans, marker) {
            if (spans) for (var i = 0; i < spans.length; ++i) {
                var span = spans[i];
                if (span.marker == marker) return span;
            }
        }
        function removeMarkedSpan(spans, span) {
            for (var r, i = 0; i < spans.length; ++i)
                if (spans[i] != span) (r || (r = [])).push(spans[i]);
            return r;
        }
        function addMarkedSpan(line, span) {
            line.markedSpans = line.markedSpans ? line.markedSpans.concat([span]) : [span];
            span.marker.attachLine(line);
        }

        function markedSpansBefore(old, startCh, isInsert) {
            if (old) for (var i = 0, nw; i < old.length; ++i) {
                var span = old[i], marker = span.marker;
                var startsBefore = span.from == null || (marker.inclusiveLeft ? span.from <= startCh : span.from < startCh);
                if (startsBefore || marker.type == "bookmark" && span.from == startCh && (!isInsert || !span.marker.insertLeft)) {
                    var endsAfter = span.to == null || (marker.inclusiveRight ? span.to >= startCh : span.to > startCh);
                    (nw || (nw = [])).push({from: span.from,
                        to: endsAfter ? null : span.to,
                        marker: marker});
                }
            }
            return nw;
        }

        function markedSpansAfter(old, endCh, isInsert) {
            if (old) for (var i = 0, nw; i < old.length; ++i) {
                var span = old[i], marker = span.marker;
                var endsAfter = span.to == null || (marker.inclusiveRight ? span.to >= endCh : span.to > endCh);
                if (endsAfter || marker.type == "bookmark" && span.from == endCh && (!isInsert || span.marker.insertLeft)) {
                    var startsBefore = span.from == null || (marker.inclusiveLeft ? span.from <= endCh : span.from < endCh);
                    (nw || (nw = [])).push({from: startsBefore ? null : span.from - endCh,
                        to: span.to == null ? null : span.to - endCh,
                        marker: marker});
                }
            }
            return nw;
        }

        function stretchSpansOverChange(doc, change) {
            var oldFirst = isLine(doc, change.from.line) && getLine(doc, change.from.line).markedSpans;
            var oldLast = isLine(doc, change.to.line) && getLine(doc, change.to.line).markedSpans;
            if (!oldFirst && !oldLast) return null;

            var startCh = change.from.ch, endCh = change.to.ch, isInsert = posEq(change.from, change.to);
            // Get the spans that 'stick out' on both sides
            var first = markedSpansBefore(oldFirst, startCh, isInsert);
            var last = markedSpansAfter(oldLast, endCh, isInsert);

            // Next, merge those two ends
            var sameLine = change.text.length == 1, offset = lst(change.text).length + (sameLine ? startCh : 0);
            if (first) {
                // Fix up .to properties of first
                for (var i = 0; i < first.length; ++i) {
                    var span = first[i];
                    if (span.to == null) {
                        var found = getMarkedSpanFor(last, span.marker);
                        if (!found) span.to = startCh;
                        else if (sameLine) span.to = found.to == null ? null : found.to + offset;
                    }
                }
            }
            if (last) {
                // Fix up .from in last (or move them into first in case of sameLine)
                for (var i = 0; i < last.length; ++i) {
                    var span = last[i];
                    if (span.to != null) span.to += offset;
                    if (span.from == null) {
                        var found = getMarkedSpanFor(first, span.marker);
                        if (!found) {
                            span.from = offset;
                            if (sameLine) (first || (first = [])).push(span);
                        }
                    } else {
                        span.from += offset;
                        if (sameLine) (first || (first = [])).push(span);
                    }
                }
            }
            if (sameLine && first) {
                // Make sure we didn't create any zero-length spans
                for (var i = 0; i < first.length; ++i)
                    if (first[i].from != null && first[i].from == first[i].to && first[i].marker.type != "bookmark")
                        first.splice(i--, 1);
                if (!first.length) first = null;
            }

            var newMarkers = [first];
            if (!sameLine) {
                // Fill gap with whole-line-spans
                var gap = change.text.length - 2, gapMarkers;
                if (gap > 0 && first)
                    for (var i = 0; i < first.length; ++i)
                        if (first[i].to == null)
                            (gapMarkers || (gapMarkers = [])).push({from: null, to: null, marker: first[i].marker});
                for (var i = 0; i < gap; ++i)
                    newMarkers.push(gapMarkers);
                newMarkers.push(last);
            }
            return newMarkers;
        }

        function mergeOldSpans(doc, change) {
            var old = getOldSpans(doc, change);
            var stretched = stretchSpansOverChange(doc, change);
            if (!old) return stretched;
            if (!stretched) return old;

            for (var i = 0; i < old.length; ++i) {
                var oldCur = old[i], stretchCur = stretched[i];
                if (oldCur && stretchCur) {
                    spans: for (var j = 0; j < stretchCur.length; ++j) {
                        var span = stretchCur[j];
                        for (var k = 0; k < oldCur.length; ++k)
                            if (oldCur[k].marker == span.marker) continue spans;
                        oldCur.push(span);
                    }
                } else if (stretchCur) {
                    old[i] = stretchCur;
                }
            }
            return old;
        }

        function removeReadOnlyRanges(doc, from, to) {
            var markers = null;
            doc.iter(from.line, to.line + 1, function(line) {
                if (line.markedSpans) for (var i = 0; i < line.markedSpans.length; ++i) {
                    var mark = line.markedSpans[i].marker;
                    if (mark.readOnly && (!markers || indexOf(markers, mark) == -1))
                        (markers || (markers = [])).push(mark);
                }
            });
            if (!markers) return null;
            var parts = [{from: from, to: to}];
            for (var i = 0; i < markers.length; ++i) {
                var mk = markers[i], m = mk.find();
                for (var j = 0; j < parts.length; ++j) {
                    var p = parts[j];
                    if (posLess(p.to, m.from) || posLess(m.to, p.from)) continue;
                    var newParts = [j, 1];
                    if (posLess(p.from, m.from) || !mk.inclusiveLeft && posEq(p.from, m.from))
                        newParts.push({from: p.from, to: m.from});
                    if (posLess(m.to, p.to) || !mk.inclusiveRight && posEq(p.to, m.to))
                        newParts.push({from: m.to, to: p.to});
                    parts.splice.apply(parts, newParts);
                    j += newParts.length - 1;
                }
            }
            return parts;
        }

        function collapsedSpanAt(line, ch) {
            var sps = sawCollapsedSpans && line.markedSpans, found;
            if (sps) for (var sp, i = 0; i < sps.length; ++i) {
                sp = sps[i];
                if (!sp.marker.collapsed) continue;
                if ((sp.from == null || sp.from < ch) &&
                    (sp.to == null || sp.to > ch) &&
                    (!found || found.width < sp.marker.width))
                    found = sp.marker;
            }
            return found;
        }
        function collapsedSpanAtStart(line) { return collapsedSpanAt(line, -1); }
        function collapsedSpanAtEnd(line) { return collapsedSpanAt(line, line.text.length + 1); }

        function visualLine(doc, line) {
            var merged;
            while (merged = collapsedSpanAtStart(line))
                line = getLine(doc, merged.find().from.line);
            return line;
        }

        function lineIsHidden(doc, line) {
            var sps = sawCollapsedSpans && line.markedSpans;
            if (sps) for (var sp, i = 0; i < sps.length; ++i) {
                sp = sps[i];
                if (!sp.marker.collapsed) continue;
                if (sp.from == null) return true;
                if (sp.marker.replacedWith) continue;
                if (sp.from == 0 && sp.marker.inclusiveLeft && lineIsHiddenInner(doc, line, sp))
                    return true;
            }
        }
        function lineIsHiddenInner(doc, line, span) {
            if (span.to == null) {
                var end = span.marker.find().to, endLine = getLine(doc, end.line);
                return lineIsHiddenInner(doc, endLine, getMarkedSpanFor(endLine.markedSpans, span.marker));
            }
            if (span.marker.inclusiveRight && span.to == line.text.length)
                return true;
            for (var sp, i = 0; i < line.markedSpans.length; ++i) {
                sp = line.markedSpans[i];
                if (sp.marker.collapsed && !sp.marker.replacedWith && sp.from == span.to &&
                    (sp.marker.inclusiveLeft || span.marker.inclusiveRight) &&
                    lineIsHiddenInner(doc, line, sp)) return true;
            }
        }

        function detachMarkedSpans(line) {
            var spans = line.markedSpans;
            if (!spans) return;
            for (var i = 0; i < spans.length; ++i)
                spans[i].marker.detachLine(line);
            line.markedSpans = null;
        }

        function attachMarkedSpans(line, spans) {
            if (!spans) return;
            for (var i = 0; i < spans.length; ++i)
                spans[i].marker.attachLine(line);
            line.markedSpans = spans;
        }

        // LINE WIDGETS

        var LineWidget = CodeMirror.LineWidget = function(cm, node, options) {
            if (options) for (var opt in options) if (options.hasOwnProperty(opt))
                this[opt] = options[opt];
            this.cm = cm;
            this.node = node;
        };
        eventMixin(LineWidget);
        function widgetOperation(f) {
            return function() {
                var withOp = !this.cm.curOp;
                if (withOp) startOperation(this.cm);
                try {var result = f.apply(this, arguments);}
                finally {if (withOp) endOperation(this.cm);}
                return result;
            };
        }
        LineWidget.prototype.clear = widgetOperation(function() {
            var ws = this.line.widgets, no = lineNo(this.line);
            if (no == null || !ws) return;
            for (var i = 0; i < ws.length; ++i) if (ws[i] == this) ws.splice(i--, 1);
            if (!ws.length) this.line.widgets = null;
            var aboveVisible = heightAtLine(this.cm, this.line) < this.cm.doc.scrollTop;
            updateLineHeight(this.line, Math.max(0, this.line.height - widgetHeight(this)));
            if (aboveVisible) addToScrollPos(this.cm, 0, -this.height);
            regChange(this.cm, no, no + 1);
        });
        LineWidget.prototype.changed = widgetOperation(function() {
            var oldH = this.height;
            this.height = null;
            var diff = widgetHeight(this) - oldH;
            if (!diff) return;
            updateLineHeight(this.line, this.line.height + diff);
            var no = lineNo(this.line);
            regChange(this.cm, no, no + 1);
        });

        function widgetHeight(widget) {
            if (widget.height != null) return widget.height;
            if (!widget.node.parentNode || widget.node.parentNode.nodeType != 1)
                removeChildrenAndAdd(widget.cm.display.measure, elt("div", [widget.node], null, "position: relative"));
            return widget.height = widget.node.offsetHeight;
        }

        function addLineWidget(cm, handle, node, options) {
            var widget = new LineWidget(cm, node, options);
            if (widget.noHScroll) cm.display.alignWidgets = true;
            changeLine(cm, handle, function(line) {
                var widgets = line.widgets || (line.widgets = []);
                if (widget.insertAt == null) widgets.push(widget);
                else widgets.splice(Math.min(widgets.length - 1, Math.max(0, widget.insertAt)), 0, widget);
                widget.line = line;
                if (!lineIsHidden(cm.doc, line) || widget.showIfHidden) {
                    var aboveVisible = heightAtLine(cm, line) < cm.doc.scrollTop;
                    updateLineHeight(line, line.height + widgetHeight(widget));
                    if (aboveVisible) addToScrollPos(cm, 0, widget.height);
                }
                return true;
            });
            return widget;
        }

        // LINE DATA STRUCTURE

        // Line objects. These hold state related to a line, including
        // highlighting info (the styles array).
        var Line = CodeMirror.Line = function(text, markedSpans, estimateHeight) {
            this.text = text;
            attachMarkedSpans(this, markedSpans);
            this.height = estimateHeight ? estimateHeight(this) : 1;
        };
        eventMixin(Line);

        function updateLine(line, text, markedSpans, estimateHeight) {
            line.text = text;
            if (line.stateAfter) line.stateAfter = null;
            if (line.styles) line.styles = null;
            if (line.order != null) line.order = null;
            detachMarkedSpans(line);
            attachMarkedSpans(line, markedSpans);
            var estHeight = estimateHeight ? estimateHeight(line) : 1;
            if (estHeight != line.height) updateLineHeight(line, estHeight);
        }

        function cleanUpLine(line) {
            line.parent = null;
            detachMarkedSpans(line);
        }

        // Run the given mode's parser over a line, update the styles
        // array, which contains alternating fragments of text and CSS
        // classes.
        function runMode(cm, text, mode, state, f) {
            var flattenSpans = mode.flattenSpans;
            if (flattenSpans == null) flattenSpans = cm.options.flattenSpans;
            var curStart = 0, curStyle = null;
            var stream = new StringStream(text, cm.options.tabSize), style;
            if (text == "" && mode.blankLine) mode.blankLine(state);
            while (!stream.eol()) {
                if (stream.pos > cm.options.maxHighlightLength) {
                    flattenSpans = false;
                    // Webkit seems to refuse to render text nodes longer than 57444 characters
                    stream.pos = Math.min(text.length, stream.start + 50000);
                    style = null;
                } else {
                    style = mode.token(stream, state);
                }
                if (!flattenSpans || curStyle != style) {
                    if (curStart < stream.start) f(stream.start, curStyle);
                    curStart = stream.start; curStyle = style;
                }
                stream.start = stream.pos;
            }
            if (curStart < stream.pos) f(stream.pos, curStyle);
        }

        function highlightLine(cm, line, state) {
            // A styles array always starts with a number identifying the
            // mode/overlays that it is based on (for easy invalidation).
            var st = [cm.state.modeGen];
            // Compute the base array of styles
            runMode(cm, line.text, cm.doc.mode, state, function(end, style) {st.push(end, style);});

            // Run overlays, adjust style array.
            for (var o = 0; o < cm.state.overlays.length; ++o) {
                var overlay = cm.state.overlays[o], i = 1, at = 0;
                runMode(cm, line.text, overlay.mode, true, function(end, style) {
                    var start = i;
                    // Ensure there's a token end at the current position, and that i points at it
                    while (at < end) {
                        var i_end = st[i];
                        if (i_end > end)
                            st.splice(i, 1, end, st[i+1], i_end);
                        i += 2;
                        at = Math.min(end, i_end);
                    }
                    if (!style) return;
                    if (overlay.opaque) {
                        st.splice(start, i - start, end, style);
                        i = start + 2;
                    } else {
                        for (; start < i; start += 2) {
                            var cur = st[start+1];
                            st[start+1] = cur ? cur + " " + style : style;
                        }
                    }
                });
            }

            return st;
        }

        function getLineStyles(cm, line) {
            if (!line.styles || line.styles[0] != cm.state.modeGen)
                line.styles = highlightLine(cm, line, line.stateAfter = getStateBefore(cm, lineNo(line)));
            return line.styles;
        }

        // Lightweight form of highlight -- proceed over this line and
        // update state, but don't save a style array.
        function processLine(cm, line, state) {
            var mode = cm.doc.mode;
            var stream = new StringStream(line.text, cm.options.tabSize);
            if (line.text == "" && mode.blankLine) mode.blankLine(state);
            while (!stream.eol() && stream.pos <= cm.options.maxHighlightLength) {
                mode.token(stream, state);
                stream.start = stream.pos;
            }
        }

        var styleToClassCache = {};
        function styleToClass(style) {
            if (!style) return null;
            return styleToClassCache[style] ||
            (styleToClassCache[style] = "cm-" + style.replace(/ +/g, " cm-"));
        }

        function lineContent(cm, realLine, measure, copyWidgets) {
            var merged, line = realLine, empty = true;
            while (merged = collapsedSpanAtStart(line))
                line = getLine(cm.doc, merged.find().from.line);

            var builder = {pre: elt("pre"), col: 0, pos: 0,
                measure: null, measuredSomething: false, cm: cm,
                copyWidgets: copyWidgets};
            if (line.textClass) builder.pre.className = line.textClass;

            do {
                if (line.text) empty = false;
                builder.measure = line == realLine && measure;
                builder.pos = 0;
                builder.addToken = builder.measure ? buildTokenMeasure : buildToken;
                if ((ie || webkit) && cm.getOption("lineWrapping"))
                    builder.addToken = buildTokenSplitSpaces(builder.addToken);
                var next = insertLineContent(line, builder, getLineStyles(cm, line));
                if (measure && line == realLine && !builder.measuredSomething) {
                    measure[0] = builder.pre.appendChild(zeroWidthElement(cm.display.measure));
                    builder.measuredSomething = true;
                }
                if (next) line = getLine(cm.doc, next.to.line);
            } while (next);

            if (measure && !builder.measuredSomething && !measure[0])
                measure[0] = builder.pre.appendChild(empty ? elt("span", "\u00a0") : zeroWidthElement(cm.display.measure));
            if (!builder.pre.firstChild && !lineIsHidden(cm.doc, realLine))
                builder.pre.appendChild(document.createTextNode("\u00a0"));

            var order;
            // Work around problem with the reported dimensions of single-char
            // direction spans on IE (issue #1129). See also the comment in
            // cursorCoords.
            if (measure && ie && (order = getOrder(line))) {
                var l = order.length - 1;
                if (order[l].from == order[l].to) --l;
                var last = order[l], prev = order[l - 1];
                if (last.from + 1 == last.to && prev && last.level < prev.level) {
                    var span = measure[builder.pos - 1];
                    if (span) span.parentNode.insertBefore(span.measureRight = zeroWidthElement(cm.display.measure),
                        span.nextSibling);
                }
            }

            signal(cm, "renderLine", cm, realLine, builder.pre);
            return builder.pre;
        }

        var tokenSpecialChars = /[\t\u0000-\u0019\u00ad\u200b\u2028\u2029\uFEFF]/g;
        function buildToken(builder, text, style, startStyle, endStyle, title) {
            if (!text) return;
            if (!tokenSpecialChars.test(text)) {
                builder.col += text.length;
                var content = document.createTextNode(text);
            } else {
                var content = document.createDocumentFragment(), pos = 0;
                while (true) {
                    tokenSpecialChars.lastIndex = pos;
                    var m = tokenSpecialChars.exec(text);
                    var skipped = m ? m.index - pos : text.length - pos;
                    if (skipped) {
                        content.appendChild(document.createTextNode(text.slice(pos, pos + skipped)));
                        builder.col += skipped;
                    }
                    if (!m) break;
                    pos += skipped + 1;
                    if (m[0] == "\t") {
                        var tabSize = builder.cm.options.tabSize, tabWidth = tabSize - builder.col % tabSize;
                        content.appendChild(elt("span", spaceStr(tabWidth), "cm-tab"));
                        builder.col += tabWidth;
                    } else {
                        var token = elt("span", "\u2022", "cm-invalidchar");
                        token.title = "\\u" + m[0].charCodeAt(0).toString(16);
                        content.appendChild(token);
                        builder.col += 1;
                    }
                }
            }
            if (style || startStyle || endStyle || builder.measure) {
                var fullStyle = style || "";
                if (startStyle) fullStyle += startStyle;
                if (endStyle) fullStyle += endStyle;
                var token = elt("span", [content], fullStyle);
                if (title) token.title = title;
                return builder.pre.appendChild(token);
            }
            builder.pre.appendChild(content);
        }

        function buildTokenMeasure(builder, text, style, startStyle, endStyle) {
            var wrapping = builder.cm.options.lineWrapping;
            for (var i = 0; i < text.length; ++i) {
                var ch = text.charAt(i), start = i == 0;
                if (ch >= "\ud800" && ch < "\udbff" && i < text.length - 1) {
                    ch = text.slice(i, i + 2);
                    ++i;
                } else if (i && wrapping && spanAffectsWrapping(text, i)) {
                    builder.pre.appendChild(elt("wbr"));
                }
                var old = builder.measure[builder.pos];
                var span = builder.measure[builder.pos] =
                    buildToken(builder, ch, style,
                        start && startStyle, i == text.length - 1 && endStyle);
                if (old) span.leftSide = old.leftSide || old;
                // In IE single-space nodes wrap differently than spaces
                // embedded in larger text nodes, except when set to
                // white-space: normal (issue #1268).
                if (ie && wrapping && ch == " " && i && !/\s/.test(text.charAt(i - 1)) &&
                    i < text.length - 1 && !/\s/.test(text.charAt(i + 1)))
                    span.style.whiteSpace = "normal";
                builder.pos += ch.length;
            }
            if (text.length) builder.measuredSomething = true;
        }

        function buildTokenSplitSpaces(inner) {
            function split(old) {
                var out = " ";
                for (var i = 0; i < old.length - 2; ++i) out += i % 2 ? " " : "\u00a0";
                out += " ";
                return out;
            }
            return function(builder, text, style, startStyle, endStyle, title) {
                return inner(builder, text.replace(/ {3,}/, split), style, startStyle, endStyle, title);
            };
        }

        function buildCollapsedSpan(builder, size, marker, ignoreWidget) {
            var widget = !ignoreWidget && marker.replacedWith;
            if (widget) {
                if (builder.copyWidgets) widget = widget.cloneNode(true);
                builder.pre.appendChild(widget);
                if (builder.measure) {
                    if (size) {
                        builder.measure[builder.pos] = widget;
                    } else {
                        var elt = builder.measure[builder.pos] = zeroWidthElement(builder.cm.display.measure);
                        if (marker.type != "bookmark" || marker.insertLeft)
                            builder.pre.insertBefore(elt, widget);
                        else
                            builder.pre.appendChild(elt);
                    }
                    builder.measuredSomething = true;
                }
            }
            builder.pos += size;
        }

        // Outputs a number of spans to make up a line, taking highlighting
        // and marked text into account.
        function insertLineContent(line, builder, styles) {
            var spans = line.markedSpans, allText = line.text, at = 0;
            if (!spans) {
                for (var i = 1; i < styles.length; i+=2)
                    builder.addToken(builder, allText.slice(at, at = styles[i]), styleToClass(styles[i+1]));
                return;
            }

            var len = allText.length, pos = 0, i = 1, text = "", style;
            var nextChange = 0, spanStyle, spanEndStyle, spanStartStyle, title, collapsed;
            for (;;) {
                if (nextChange == pos) { // Update current marker set
                    spanStyle = spanEndStyle = spanStartStyle = title = "";
                    collapsed = null; nextChange = Infinity;
                    var foundBookmark = null;
                    for (var j = 0; j < spans.length; ++j) {
                        var sp = spans[j], m = sp.marker;
                        if (sp.from <= pos && (sp.to == null || sp.to > pos)) {
                            if (sp.to != null && nextChange > sp.to) { nextChange = sp.to; spanEndStyle = ""; }
                            if (m.className) spanStyle += " " + m.className;
                            if (m.startStyle && sp.from == pos) spanStartStyle += " " + m.startStyle;
                            if (m.endStyle && sp.to == nextChange) spanEndStyle += " " + m.endStyle;
                            if (m.title && !title) title = m.title;
                            if (m.collapsed && (!collapsed || collapsed.marker.size < m.size))
                                collapsed = sp;
                        } else if (sp.from > pos && nextChange > sp.from) {
                            nextChange = sp.from;
                        }
                        if (m.type == "bookmark" && sp.from == pos && m.replacedWith) foundBookmark = m;
                    }
                    if (collapsed && (collapsed.from || 0) == pos) {
                        buildCollapsedSpan(builder, (collapsed.to == null ? len : collapsed.to) - pos,
                            collapsed.marker, collapsed.from == null);
                        if (collapsed.to == null) return collapsed.marker.find();
                    }
                    if (foundBookmark && !collapsed) buildCollapsedSpan(builder, 0, foundBookmark);
                }
                if (pos >= len) break;

                var upto = Math.min(len, nextChange);
                while (true) {
                    if (text) {
                        var end = pos + text.length;
                        if (!collapsed) {
                            var tokenText = end > upto ? text.slice(0, upto - pos) : text;
                            builder.addToken(builder, tokenText, style ? style + spanStyle : spanStyle,
                                spanStartStyle, pos + tokenText.length == nextChange ? spanEndStyle : "", title);
                        }
                        if (end >= upto) {text = text.slice(upto - pos); pos = upto; break;}
                        pos = end;
                        spanStartStyle = "";
                    }
                    text = allText.slice(at, at = styles[i++]);
                    style = styleToClass(styles[i++]);
                }
            }
        }

        // DOCUMENT DATA STRUCTURE

        function updateDoc(doc, change, markedSpans, selAfter, estimateHeight) {
            function spansFor(n) {return markedSpans ? markedSpans[n] : null;}
            function update(line, text, spans) {
                updateLine(line, text, spans, estimateHeight);
                signalLater(line, "change", line, change);
            }

            var from = change.from, to = change.to, text = change.text;
            var firstLine = getLine(doc, from.line), lastLine = getLine(doc, to.line);
            var lastText = lst(text), lastSpans = spansFor(text.length - 1), nlines = to.line - from.line;

            // First adjust the line structure
            if (from.ch == 0 && to.ch == 0 && lastText == "") {
                // This is a whole-line replace. Treated specially to make
                // sure line objects move the way they are supposed to.
                for (var i = 0, e = text.length - 1, added = []; i < e; ++i)
                    added.push(new Line(text[i], spansFor(i), estimateHeight));
                update(lastLine, lastLine.text, lastSpans);
                if (nlines) doc.remove(from.line, nlines);
                if (added.length) doc.insert(from.line, added);
            } else if (firstLine == lastLine) {
                if (text.length == 1) {
                    update(firstLine, firstLine.text.slice(0, from.ch) + lastText + firstLine.text.slice(to.ch), lastSpans);
                } else {
                    for (var added = [], i = 1, e = text.length - 1; i < e; ++i)
                        added.push(new Line(text[i], spansFor(i), estimateHeight));
                    added.push(new Line(lastText + firstLine.text.slice(to.ch), lastSpans, estimateHeight));
                    update(firstLine, firstLine.text.slice(0, from.ch) + text[0], spansFor(0));
                    doc.insert(from.line + 1, added);
                }
            } else if (text.length == 1) {
                update(firstLine, firstLine.text.slice(0, from.ch) + text[0] + lastLine.text.slice(to.ch), spansFor(0));
                doc.remove(from.line + 1, nlines);
            } else {
                update(firstLine, firstLine.text.slice(0, from.ch) + text[0], spansFor(0));
                update(lastLine, lastText + lastLine.text.slice(to.ch), lastSpans);
                for (var i = 1, e = text.length - 1, added = []; i < e; ++i)
                    added.push(new Line(text[i], spansFor(i), estimateHeight));
                if (nlines > 1) doc.remove(from.line + 1, nlines - 1);
                doc.insert(from.line + 1, added);
            }

            signalLater(doc, "change", doc, change);
            setSelection(doc, selAfter.anchor, selAfter.head, null, true);
        }

        function LeafChunk(lines) {
            this.lines = lines;
            this.parent = null;
            for (var i = 0, e = lines.length, height = 0; i < e; ++i) {
                lines[i].parent = this;
                height += lines[i].height;
            }
            this.height = height;
        }

        LeafChunk.prototype = {
            chunkSize: function() { return this.lines.length; },
            removeInner: function(at, n) {
                for (var i = at, e = at + n; i < e; ++i) {
                    var line = this.lines[i];
                    this.height -= line.height;
                    cleanUpLine(line);
                    signalLater(line, "delete");
                }
                this.lines.splice(at, n);
            },
            collapse: function(lines) {
                lines.splice.apply(lines, [lines.length, 0].concat(this.lines));
            },
            insertInner: function(at, lines, height) {
                this.height += height;
                this.lines = this.lines.slice(0, at).concat(lines).concat(this.lines.slice(at));
                for (var i = 0, e = lines.length; i < e; ++i) lines[i].parent = this;
            },
            iterN: function(at, n, op) {
                for (var e = at + n; at < e; ++at)
                    if (op(this.lines[at])) return true;
            }
        };

        function BranchChunk(children) {
            this.children = children;
            var size = 0, height = 0;
            for (var i = 0, e = children.length; i < e; ++i) {
                var ch = children[i];
                size += ch.chunkSize(); height += ch.height;
                ch.parent = this;
            }
            this.size = size;
            this.height = height;
            this.parent = null;
        }

        BranchChunk.prototype = {
            chunkSize: function() { return this.size; },
            removeInner: function(at, n) {
                this.size -= n;
                for (var i = 0; i < this.children.length; ++i) {
                    var child = this.children[i], sz = child.chunkSize();
                    if (at < sz) {
                        var rm = Math.min(n, sz - at), oldHeight = child.height;
                        child.removeInner(at, rm);
                        this.height -= oldHeight - child.height;
                        if (sz == rm) { this.children.splice(i--, 1); child.parent = null; }
                        if ((n -= rm) == 0) break;
                        at = 0;
                    } else at -= sz;
                }
                if (this.size - n < 25) {
                    var lines = [];
                    this.collapse(lines);
                    this.children = [new LeafChunk(lines)];
                    this.children[0].parent = this;
                }
            },
            collapse: function(lines) {
                for (var i = 0, e = this.children.length; i < e; ++i) this.children[i].collapse(lines);
            },
            insertInner: function(at, lines, height) {
                this.size += lines.length;
                this.height += height;
                for (var i = 0, e = this.children.length; i < e; ++i) {
                    var child = this.children[i], sz = child.chunkSize();
                    if (at <= sz) {
                        child.insertInner(at, lines, height);
                        if (child.lines && child.lines.length > 50) {
                            while (child.lines.length > 50) {
                                var spilled = child.lines.splice(child.lines.length - 25, 25);
                                var newleaf = new LeafChunk(spilled);
                                child.height -= newleaf.height;
                                this.children.splice(i + 1, 0, newleaf);
                                newleaf.parent = this;
                            }
                            this.maybeSpill();
                        }
                        break;
                    }
                    at -= sz;
                }
            },
            maybeSpill: function() {
                if (this.children.length <= 10) return;
                var me = this;
                do {
                    var spilled = me.children.splice(me.children.length - 5, 5);
                    var sibling = new BranchChunk(spilled);
                    if (!me.parent) { // Become the parent node
                        var copy = new BranchChunk(me.children);
                        copy.parent = me;
                        me.children = [copy, sibling];
                        me = copy;
                    } else {
                        me.size -= sibling.size;
                        me.height -= sibling.height;
                        var myIndex = indexOf(me.parent.children, me);
                        me.parent.children.splice(myIndex + 1, 0, sibling);
                    }
                    sibling.parent = me.parent;
                } while (me.children.length > 10);
                me.parent.maybeSpill();
            },
            iterN: function(at, n, op) {
                for (var i = 0, e = this.children.length; i < e; ++i) {
                    var child = this.children[i], sz = child.chunkSize();
                    if (at < sz) {
                        var used = Math.min(n, sz - at);
                        if (child.iterN(at, used, op)) return true;
                        if ((n -= used) == 0) break;
                        at = 0;
                    } else at -= sz;
                }
            }
        };

        var nextDocId = 0;
        var Doc = CodeMirror.Doc = function(text, mode, firstLine) {
            if (!(this instanceof Doc)) return new Doc(text, mode, firstLine);
            if (firstLine == null) firstLine = 0;

            BranchChunk.call(this, [new LeafChunk([new Line("", null)])]);
            this.first = firstLine;
            this.scrollTop = this.scrollLeft = 0;
            this.cantEdit = false;
            this.history = makeHistory();
            this.cleanGeneration = 1;
            this.frontier = firstLine;
            var start = Pos(firstLine, 0);
            this.sel = {from: start, to: start, head: start, anchor: start, shift: false, extend: false, goalColumn: null};
            this.id = ++nextDocId;
            this.modeOption = mode;

            if (typeof text == "string") text = splitLines(text);
            updateDoc(this, {from: start, to: start, text: text}, null, {head: start, anchor: start});
        };

        Doc.prototype = createObj(BranchChunk.prototype, {
            constructor: Doc,
            iter: function(from, to, op) {
                if (op) this.iterN(from - this.first, to - from, op);
                else this.iterN(this.first, this.first + this.size, from);
            },

            insert: function(at, lines) {
                var height = 0;
                for (var i = 0, e = lines.length; i < e; ++i) height += lines[i].height;
                this.insertInner(at - this.first, lines, height);
            },
            remove: function(at, n) { this.removeInner(at - this.first, n); },

            getValue: function(lineSep) {
                var lines = getLines(this, this.first, this.first + this.size);
                if (lineSep === false) return lines;
                return lines.join(lineSep || "\n");
            },
            setValue: function(code) {
                var top = Pos(this.first, 0), last = this.first + this.size - 1;
                makeChange(this, {from: top, to: Pos(last, getLine(this, last).text.length),
                        text: splitLines(code), origin: "setValue"},
                    {head: top, anchor: top}, true);
            },
            replaceRange: function(code, from, to, origin) {
                from = clipPos(this, from);
                to = to ? clipPos(this, to) : from;
                replaceRange(this, code, from, to, origin);
            },
            getRange: function(from, to, lineSep) {
                var lines = getBetween(this, clipPos(this, from), clipPos(this, to));
                if (lineSep === false) return lines;
                return lines.join(lineSep || "\n");
            },

            getLine: function(line) {var l = this.getLineHandle(line); return l && l.text;},
            setLine: function(line, text) {
                if (isLine(this, line))
                    replaceRange(this, text, Pos(line, 0), clipPos(this, Pos(line)));
            },
            removeLine: function(line) {
                if (line) replaceRange(this, "", clipPos(this, Pos(line - 1)), clipPos(this, Pos(line)));
                else replaceRange(this, "", Pos(0, 0), clipPos(this, Pos(1, 0)));
            },

            getLineHandle: function(line) {if (isLine(this, line)) return getLine(this, line);},
            getLineNumber: function(line) {return lineNo(line);},

            getLineHandleVisualStart: function(line) {
                if (typeof line == "number") line = getLine(this, line);
                return visualLine(this, line);
            },

            lineCount: function() {return this.size;},
            firstLine: function() {return this.first;},
            lastLine: function() {return this.first + this.size - 1;},

            clipPos: function(pos) {return clipPos(this, pos);},

            getCursor: function(start) {
                var sel = this.sel, pos;
                if (start == null || start == "head") pos = sel.head;
                else if (start == "anchor") pos = sel.anchor;
                else if (start == "end" || start === false) pos = sel.to;
                else pos = sel.from;
                return copyPos(pos);
            },
            somethingSelected: function() {return !posEq(this.sel.head, this.sel.anchor);},

            setCursor: docOperation(function(line, ch, extend) {
                var pos = clipPos(this, typeof line == "number" ? Pos(line, ch || 0) : line);
                if (extend) extendSelection(this, pos);
                else setSelection(this, pos, pos);
            }),
            setSelection: docOperation(function(anchor, head) {
                setSelection(this, clipPos(this, anchor), clipPos(this, head || anchor));
            }),
            extendSelection: docOperation(function(from, to) {
                extendSelection(this, clipPos(this, from), to && clipPos(this, to));
            }),

            getSelection: function(lineSep) {return this.getRange(this.sel.from, this.sel.to, lineSep);},
            replaceSelection: function(code, collapse, origin) {
                makeChange(this, {from: this.sel.from, to: this.sel.to, text: splitLines(code), origin: origin}, collapse || "around");
            },
            undo: docOperation(function() {makeChangeFromHistory(this, "undo");}),
            redo: docOperation(function() {makeChangeFromHistory(this, "redo");}),

            setExtending: function(val) {this.sel.extend = val;},

            historySize: function() {
                var hist = this.history;
                return {undo: hist.done.length, redo: hist.undone.length};
            },
            clearHistory: function() {this.history = makeHistory(this.history.maxGeneration);},

            markClean: function() {
                this.cleanGeneration = this.changeGeneration();
            },
            changeGeneration: function() {
                this.history.lastOp = this.history.lastOrigin = null;
                return this.history.generation;
            },
            isClean: function (gen) {
                return this.history.generation == (gen || this.cleanGeneration);
            },

            getHistory: function() {
                return {done: copyHistoryArray(this.history.done),
                    undone: copyHistoryArray(this.history.undone)};
            },
            setHistory: function(histData) {
                var hist = this.history = makeHistory(this.history.maxGeneration);
                hist.done = histData.done.slice(0);
                hist.undone = histData.undone.slice(0);
            },

            markText: function(from, to, options) {
                return markText(this, clipPos(this, from), clipPos(this, to), options, "range");
            },
            setBookmark: function(pos, options) {
                var realOpts = {replacedWith: options && (options.nodeType == null ? options.widget : options),
                    insertLeft: options && options.insertLeft};
                pos = clipPos(this, pos);
                return markText(this, pos, pos, realOpts, "bookmark");
            },
            findMarksAt: function(pos) {
                pos = clipPos(this, pos);
                var markers = [], spans = getLine(this, pos.line).markedSpans;
                if (spans) for (var i = 0; i < spans.length; ++i) {
                    var span = spans[i];
                    if ((span.from == null || span.from <= pos.ch) &&
                        (span.to == null || span.to >= pos.ch))
                        markers.push(span.marker.parent || span.marker);
                }
                return markers;
            },
            getAllMarks: function() {
                var markers = [];
                this.iter(function(line) {
                    var sps = line.markedSpans;
                    if (sps) for (var i = 0; i < sps.length; ++i)
                        if (sps[i].from != null) markers.push(sps[i].marker);
                });
                return markers;
            },

            posFromIndex: function(off) {
                var ch, lineNo = this.first;
                this.iter(function(line) {
                    var sz = line.text.length + 1;
                    if (sz > off) { ch = off; return true; }
                    off -= sz;
                    ++lineNo;
                });
                return clipPos(this, Pos(lineNo, ch));
            },
            indexFromPos: function (coords) {
                coords = clipPos(this, coords);
                var index = coords.ch;
                if (coords.line < this.first || coords.ch < 0) return 0;
                this.iter(this.first, coords.line, function (line) {
                    index += line.text.length + 1;
                });
                return index;
            },

            copy: function(copyHistory) {
                var doc = new Doc(getLines(this, this.first, this.first + this.size), this.modeOption, this.first);
                doc.scrollTop = this.scrollTop; doc.scrollLeft = this.scrollLeft;
                doc.sel = {from: this.sel.from, to: this.sel.to, head: this.sel.head, anchor: this.sel.anchor,
                    shift: this.sel.shift, extend: false, goalColumn: this.sel.goalColumn};
                if (copyHistory) {
                    doc.history.undoDepth = this.history.undoDepth;
                    doc.setHistory(this.getHistory());
                }
                return doc;
            },

            linkedDoc: function(options) {
                if (!options) options = {};
                var from = this.first, to = this.first + this.size;
                if (options.from != null && options.from > from) from = options.from;
                if (options.to != null && options.to < to) to = options.to;
                var copy = new Doc(getLines(this, from, to), options.mode || this.modeOption, from);
                if (options.sharedHist) copy.history = this.history;
                (this.linked || (this.linked = [])).push({doc: copy, sharedHist: options.sharedHist});
                copy.linked = [{doc: this, isParent: true, sharedHist: options.sharedHist}];
                return copy;
            },
            unlinkDoc: function(other) {
                if (other instanceof CodeMirror) other = other.doc;
                if (this.linked) for (var i = 0; i < this.linked.length; ++i) {
                    var link = this.linked[i];
                    if (link.doc != other) continue;
                    this.linked.splice(i, 1);
                    other.unlinkDoc(this);
                    break;
                }
                // If the histories were shared, split them again
                if (other.history == this.history) {
                    var splitIds = [other.id];
                    linkedDocs(other, function(doc) {splitIds.push(doc.id);}, true);
                    other.history = makeHistory();
                    other.history.done = copyHistoryArray(this.history.done, splitIds);
                    other.history.undone = copyHistoryArray(this.history.undone, splitIds);
                }
            },
            iterLinkedDocs: function(f) {linkedDocs(this, f);},

            getMode: function() {return this.mode;},
            getEditor: function() {return this.cm;}
        });

        Doc.prototype.eachLine = Doc.prototype.iter;

        // The Doc methods that should be available on CodeMirror instances
        var dontDelegate = "iter insert remove copy getEditor".split(" ");
        for (var prop in Doc.prototype) if (Doc.prototype.hasOwnProperty(prop) && indexOf(dontDelegate, prop) < 0)
            CodeMirror.prototype[prop] = (function(method) {
                return function() {return method.apply(this.doc, arguments);};
            })(Doc.prototype[prop]);

        eventMixin(Doc);

        function linkedDocs(doc, f, sharedHistOnly) {
            function propagate(doc, skip, sharedHist) {
                if (doc.linked) for (var i = 0; i < doc.linked.length; ++i) {
                    var rel = doc.linked[i];
                    if (rel.doc == skip) continue;
                    var shared = sharedHist && rel.sharedHist;
                    if (sharedHistOnly && !shared) continue;
                    f(rel.doc, shared);
                    propagate(rel.doc, doc, shared);
                }
            }
            propagate(doc, null, true);
        }

        function attachDoc(cm, doc) {
            if (doc.cm) throw new Error("This document is already in use.");
            cm.doc = doc;
            doc.cm = cm;
            estimateLineHeights(cm);
            loadMode(cm);
            if (!cm.options.lineWrapping) computeMaxLength(cm);
            cm.options.mode = doc.modeOption;
            regChange(cm);
        }

        // LINE UTILITIES

        function getLine(chunk, n) {
            n -= chunk.first;
            while (!chunk.lines) {
                for (var i = 0;; ++i) {
                    var child = chunk.children[i], sz = child.chunkSize();
                    if (n < sz) { chunk = child; break; }
                    n -= sz;
                }
            }
            return chunk.lines[n];
        }

        function getBetween(doc, start, end) {
            var out = [], n = start.line;
            doc.iter(start.line, end.line + 1, function(line) {
                var text = line.text;
                if (n == end.line) text = text.slice(0, end.ch);
                if (n == start.line) text = text.slice(start.ch);
                out.push(text);
                ++n;
            });
            return out;
        }
        function getLines(doc, from, to) {
            var out = [];
            doc.iter(from, to, function(line) { out.push(line.text); });
            return out;
        }

        function updateLineHeight(line, height) {
            var diff = height - line.height;
            for (var n = line; n; n = n.parent) n.height += diff;
        }

        function lineNo(line) {
            if (line.parent == null) return null;
            var cur = line.parent, no = indexOf(cur.lines, line);
            for (var chunk = cur.parent; chunk; cur = chunk, chunk = chunk.parent) {
                for (var i = 0;; ++i) {
                    if (chunk.children[i] == cur) break;
                    no += chunk.children[i].chunkSize();
                }
            }
            return no + cur.first;
        }

        function lineAtHeight(chunk, h) {
            var n = chunk.first;
            outer: do {
                for (var i = 0, e = chunk.children.length; i < e; ++i) {
                    var child = chunk.children[i], ch = child.height;
                    if (h < ch) { chunk = child; continue outer; }
                    h -= ch;
                    n += child.chunkSize();
                }
                return n;
            } while (!chunk.lines);
            for (var i = 0, e = chunk.lines.length; i < e; ++i) {
                var line = chunk.lines[i], lh = line.height;
                if (h < lh) break;
                h -= lh;
            }
            return n + i;
        }

        function heightAtLine(cm, lineObj) {
            lineObj = visualLine(cm.doc, lineObj);

            var h = 0, chunk = lineObj.parent;
            for (var i = 0; i < chunk.lines.length; ++i) {
                var line = chunk.lines[i];
                if (line == lineObj) break;
                else h += line.height;
            }
            for (var p = chunk.parent; p; chunk = p, p = chunk.parent) {
                for (var i = 0; i < p.children.length; ++i) {
                    var cur = p.children[i];
                    if (cur == chunk) break;
                    else h += cur.height;
                }
            }
            return h;
        }

        function getOrder(line) {
            var order = line.order;
            if (order == null) order = line.order = bidiOrdering(line.text);
            return order;
        }

        // HISTORY

        function makeHistory(startGen) {
            return {
                // Arrays of history events. Doing something adds an event to
                // done and clears undo. Undoing moves events from done to
                // undone, redoing moves them in the other direction.
                done: [], undone: [], undoDepth: Infinity,
                // Used to track when changes can be merged into a single undo
                // event
                lastTime: 0, lastOp: null, lastOrigin: null,
                // Used by the isClean() method
                generation: startGen || 1, maxGeneration: startGen || 1
            };
        }

        function attachLocalSpans(doc, change, from, to) {
            var existing = change["spans_" + doc.id], n = 0;
            doc.iter(Math.max(doc.first, from), Math.min(doc.first + doc.size, to), function(line) {
                if (line.markedSpans)
                    (existing || (existing = change["spans_" + doc.id] = {}))[n] = line.markedSpans;
                ++n;
            });
        }

        function historyChangeFromChange(doc, change) {
            var from = { line: change.from.line, ch: change.from.ch };
            var histChange = {from: from, to: changeEnd(change), text: getBetween(doc, change.from, change.to)};
            attachLocalSpans(doc, histChange, change.from.line, change.to.line + 1);
            linkedDocs(doc, function(doc) {attachLocalSpans(doc, histChange, change.from.line, change.to.line + 1);}, true);
            return histChange;
        }

        function addToHistory(doc, change, selAfter, opId) {
            var hist = doc.history;
            hist.undone.length = 0;
            var time = +new Date, cur = lst(hist.done);

            if (cur &&
                (hist.lastOp == opId ||
                hist.lastOrigin == change.origin && change.origin &&
                ((change.origin.charAt(0) == "+" && doc.cm && hist.lastTime > time - doc.cm.options.historyEventDelay) ||
                change.origin.charAt(0) == "*"))) {
                // Merge this change into the last event
                var last = lst(cur.changes);
                if (posEq(change.from, change.to) && posEq(change.from, last.to)) {
                    // Optimized case for simple insertion -- don't want to add
                    // new changesets for every character typed
                    last.to = changeEnd(change);
                } else {
                    // Add new sub-event
                    cur.changes.push(historyChangeFromChange(doc, change));
                }
                cur.anchorAfter = selAfter.anchor; cur.headAfter = selAfter.head;
            } else {
                // Can not be merged, start a new event.
                cur = {changes: [historyChangeFromChange(doc, change)],
                    generation: hist.generation,
                    anchorBefore: doc.sel.anchor, headBefore: doc.sel.head,
                    anchorAfter: selAfter.anchor, headAfter: selAfter.head};
                hist.done.push(cur);
                hist.generation = ++hist.maxGeneration;
                while (hist.done.length > hist.undoDepth)
                    hist.done.shift();
            }
            hist.lastTime = time;
            hist.lastOp = opId;
            hist.lastOrigin = change.origin;
        }

        function removeClearedSpans(spans) {
            if (!spans) return null;
            for (var i = 0, out; i < spans.length; ++i) {
                if (spans[i].marker.explicitlyCleared) { if (!out) out = spans.slice(0, i); }
                else if (out) out.push(spans[i]);
            }
            return !out ? spans : out.length ? out : null;
        }

        function getOldSpans(doc, change) {
            var found = change["spans_" + doc.id];
            if (!found) return null;
            for (var i = 0, nw = []; i < change.text.length; ++i)
                nw.push(removeClearedSpans(found[i]));
            return nw;
        }

        // Used both to provide a JSON-safe object in .getHistory, and, when
        // detaching a document, to split the history in two
        function copyHistoryArray(events, newGroup) {
            for (var i = 0, copy = []; i < events.length; ++i) {
                var event = events[i], changes = event.changes, newChanges = [];
                copy.push({changes: newChanges, anchorBefore: event.anchorBefore, headBefore: event.headBefore,
                    anchorAfter: event.anchorAfter, headAfter: event.headAfter});
                for (var j = 0; j < changes.length; ++j) {
                    var change = changes[j], m;
                    newChanges.push({from: change.from, to: change.to, text: change.text});
                    if (newGroup) for (var prop in change) if (m = prop.match(/^spans_(\d+)$/)) {
                        if (indexOf(newGroup, Number(m[1])) > -1) {
                            lst(newChanges)[prop] = change[prop];
                            delete change[prop];
                        }
                    }
                }
            }
            return copy;
        }

        // Rebasing/resetting history to deal with externally-sourced changes

        function rebaseHistSel(pos, from, to, diff) {
            if (to < pos.line) {
                pos.line += diff;
            } else if (from < pos.line) {
                pos.line = from;
                pos.ch = 0;
            }
        }

        // Tries to rebase an array of history events given a change in the
        // document. If the change touches the same lines as the event, the
        // event, and everything 'behind' it, is discarded. If the change is
        // before the event, the event's positions are updated. Uses a
        // copy-on-write scheme for the positions, to avoid having to
        // reallocate them all on every rebase, but also avoid problems with
        // shared position objects being unsafely updated.
        function rebaseHistArray(array, from, to, diff) {
            for (var i = 0; i < array.length; ++i) {
                var sub = array[i], ok = true;
                for (var j = 0; j < sub.changes.length; ++j) {
                    var cur = sub.changes[j];
                    if (!sub.copied) { cur.from = copyPos(cur.from); cur.to = copyPos(cur.to); }
                    if (to < cur.from.line) {
                        cur.from.line += diff;
                        cur.to.line += diff;
                    } else if (from <= cur.to.line) {
                        ok = false;
                        break;
                    }
                }
                if (!sub.copied) {
                    sub.anchorBefore = copyPos(sub.anchorBefore); sub.headBefore = copyPos(sub.headBefore);
                    sub.anchorAfter = copyPos(sub.anchorAfter); sub.readAfter = copyPos(sub.headAfter);
                    sub.copied = true;
                }
                if (!ok) {
                    array.splice(0, i + 1);
                    i = 0;
                } else {
                    rebaseHistSel(sub.anchorBefore); rebaseHistSel(sub.headBefore);
                    rebaseHistSel(sub.anchorAfter); rebaseHistSel(sub.headAfter);
                }
            }
        }

        function rebaseHist(hist, change) {
            var from = change.from.line, to = change.to.line, diff = change.text.length - (to - from) - 1;
            rebaseHistArray(hist.done, from, to, diff);
            rebaseHistArray(hist.undone, from, to, diff);
        }

        // EVENT OPERATORS

        function stopMethod() {e_stop(this);}
        // Ensure an event has a stop method.
        function addStop(event) {
            if (!event.stop) event.stop = stopMethod;
            return event;
        }

        function e_preventDefault(e) {
            if (e.preventDefault) e.preventDefault();
            else e.returnValue = false;
        }
        function e_stopPropagation(e) {
            if (e.stopPropagation) e.stopPropagation();
            else e.cancelBubble = true;
        }
        function e_defaultPrevented(e) {
            return e.defaultPrevented != null ? e.defaultPrevented : e.returnValue == false;
        }
        function e_stop(e) {e_preventDefault(e); e_stopPropagation(e);}
        CodeMirror.e_stop = e_stop;
        CodeMirror.e_preventDefault = e_preventDefault;
        CodeMirror.e_stopPropagation = e_stopPropagation;

        function e_target(e) {return e.target || e.srcElement;}
        function e_button(e) {
            var b = e.which;
            if (b == null) {
                if (e.button & 1) b = 1;
                else if (e.button & 2) b = 3;
                else if (e.button & 4) b = 2;
            }
            if (mac && e.ctrlKey && b == 1) b = 3;
            return b;
        }

        // EVENT HANDLING

        function on(emitter, type, f) {
            if (emitter.addEventListener)
                emitter.addEventListener(type, f, false);
            else if (emitter.attachEvent)
                emitter.attachEvent("on" + type, f);
            else {
                var map = emitter._handlers || (emitter._handlers = {});
                var arr = map[type] || (map[type] = []);
                arr.push(f);
            }
        }

        function off(emitter, type, f) {
            if (emitter.removeEventListener)
                emitter.removeEventListener(type, f, false);
            else if (emitter.detachEvent)
                emitter.detachEvent("on" + type, f);
            else {
                var arr = emitter._handlers && emitter._handlers[type];
                if (!arr) return;
                for (var i = 0; i < arr.length; ++i)
                    if (arr[i] == f) { arr.splice(i, 1); break; }
            }
        }

        function signal(emitter, type /*, values...*/) {
            var arr = emitter._handlers && emitter._handlers[type];
            if (!arr) return;
            var args = Array.prototype.slice.call(arguments, 2);
            for (var i = 0; i < arr.length; ++i) arr[i].apply(null, args);
        }

        var delayedCallbacks, delayedCallbackDepth = 0;
        function signalLater(emitter, type /*, values...*/) {
            var arr = emitter._handlers && emitter._handlers[type];
            if (!arr) return;
            var args = Array.prototype.slice.call(arguments, 2);
            if (!delayedCallbacks) {
                ++delayedCallbackDepth;
                delayedCallbacks = [];
                setTimeout(fireDelayed, 0);
            }
            function bnd(f) {return function(){f.apply(null, args);};};
            for (var i = 0; i < arr.length; ++i)
                delayedCallbacks.push(bnd(arr[i]));
        }

        function signalDOMEvent(cm, e, override) {
            signal(cm, override || e.type, cm, e);
            return e_defaultPrevented(e) || e.codemirrorIgnore;
        }

        function fireDelayed() {
            --delayedCallbackDepth;
            var delayed = delayedCallbacks;
            delayedCallbacks = null;
            for (var i = 0; i < delayed.length; ++i) delayed[i]();
        }

        function hasHandler(emitter, type) {
            var arr = emitter._handlers && emitter._handlers[type];
            return arr && arr.length > 0;
        }

        CodeMirror.on = on; CodeMirror.off = off; CodeMirror.signal = signal;

        function eventMixin(ctor) {
            ctor.prototype.on = function(type, f) {on(this, type, f);};
            ctor.prototype.off = function(type, f) {off(this, type, f);};
        }

        // MISC UTILITIES

        // Number of pixels added to scroller and sizer to hide scrollbar
        var scrollerCutOff = 30;

        // Returned or thrown by various protocols to signal 'I'm not
        // handling this'.
        var Pass = CodeMirror.Pass = {toString: function(){return "CodeMirror.Pass";}};

        function Delayed() {this.id = null;}
        Delayed.prototype = {set: function(ms, f) {clearTimeout(this.id); this.id = setTimeout(f, ms);}};

        // Counts the column offset in a string, taking tabs into account.
        // Used mostly to find indentation.
        function countColumn(string, end, tabSize, startIndex, startValue) {
            if (end == null) {
                end = string.search(/[^\s\u00a0]/);
                if (end == -1) end = string.length;
            }
            for (var i = startIndex || 0, n = startValue || 0; i < end; ++i) {
                if (string.charAt(i) == "\t") n += tabSize - (n % tabSize);
                else ++n;
            }
            return n;
        }
        CodeMirror.countColumn = countColumn;

        var spaceStrs = [""];
        function spaceStr(n) {
            while (spaceStrs.length <= n)
                spaceStrs.push(lst(spaceStrs) + " ");
            return spaceStrs[n];
        }

        function lst(arr) { return arr[arr.length-1]; }

        function selectInput(node) {
            if (ios) { // Mobile Safari apparently has a bug where select() is broken.
                node.selectionStart = 0;
                node.selectionEnd = node.value.length;
            } else {
                // Suppress mysterious IE10 errors
                try { node.select(); }
                catch(_e) {}
            }
        }

        function indexOf(collection, elt) {
            if (collection.indexOf) return collection.indexOf(elt);
            for (var i = 0, e = collection.length; i < e; ++i)
                if (collection[i] == elt) return i;
            return -1;
        }

        function createObj(base, props) {
            function Obj() {}
            Obj.prototype = base;
            var inst = new Obj();
            if (props) copyObj(props, inst);
            return inst;
        }

        function copyObj(obj, target) {
            if (!target) target = {};
            for (var prop in obj) if (obj.hasOwnProperty(prop)) target[prop] = obj[prop];
            return target;
        }

        function emptyArray(size) {
            for (var a = [], i = 0; i < size; ++i) a.push(undefined);
            return a;
        }

        function bind(f) {
            var args = Array.prototype.slice.call(arguments, 1);
            return function(){return f.apply(null, args);};
        }

        var nonASCIISingleCaseWordChar = /[\u3040-\u309f\u30a0-\u30ff\u3400-\u4db5\u4e00-\u9fcc\uac00-\ud7af]/;
        function isWordChar(ch) {
            return /\w/.test(ch) || ch > "\x80" &&
            (ch.toUpperCase() != ch.toLowerCase() || nonASCIISingleCaseWordChar.test(ch));
        }

        function isEmpty(obj) {
            for (var n in obj) if (obj.hasOwnProperty(n) && obj[n]) return false;
            return true;
        }

        var isExtendingChar = /[\u0300-\u036F\u0483-\u0487\u0488-\u0489\u0591-\u05BD\u05BF\u05C1-\u05C2\u05C4-\u05C5\u05C7\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\uA66F\uA670-\uA672\uA674-\uA67D\uA69F\udc00-\udfff]/;

        // DOM UTILITIES

        function elt(tag, content, className, style) {
            var e = document.createElement(tag);
            if (className) e.className = className;
            if (style) e.style.cssText = style;
            if (typeof content == "string") setTextContent(e, content);
            else if (content) for (var i = 0; i < content.length; ++i) e.appendChild(content[i]);
            return e;
        }

        function removeChildren(e) {
            for (var count = e.childNodes.length; count > 0; --count)
                e.removeChild(e.firstChild);
            return e;
        }

        function removeChildrenAndAdd(parent, e) {
            return removeChildren(parent).appendChild(e);
        }

        function setTextContent(e, str) {
            if (ie_lt9) {
                e.innerHTML = "";
                e.appendChild(document.createTextNode(str));
            } else e.textContent = str;
        }

        function getRect(node) {
            return node.getBoundingClientRect();
        }
        CodeMirror.replaceGetRect = function(f) { getRect = f; };

        // FEATURE DETECTION

        // Detect drag-and-drop
        var dragAndDrop = function() {
            // There is *some* kind of drag-and-drop support in IE6-8, but I
            // couldn't get it to work yet.
            if (ie_lt9) return false;
            var div = elt('div');
            return "draggable" in div || "dragDrop" in div;
        }();

        // For a reason I have yet to figure out, some browsers disallow
        // word wrapping between certain characters *only* if a new inline
        // element is started between them. This makes it hard to reliably
        // measure the position of things, since that requires inserting an
        // extra span. This terribly fragile set of tests matches the
        // character combinations that suffer from this phenomenon on the
        // various browsers.
        function spanAffectsWrapping() { return false; }
        if (gecko) // Only for "$'"
            spanAffectsWrapping = function(str, i) {
                return str.charCodeAt(i - 1) == 36 && str.charCodeAt(i) == 39;
            };
        else if (safari && !/Version\/([6-9]|\d\d)\b/.test(navigator.userAgent))
            spanAffectsWrapping = function(str, i) {
                return /\-[^ \-?]|\?[^ !\'\"\),.\-\/:;\?\]\}]/.test(str.slice(i - 1, i + 1));
            };
        else if (webkit && !/Chrome\/(?:29|[3-9]\d|\d\d\d)\./.test(navigator.userAgent))
            spanAffectsWrapping = function(str, i) {
                if (i > 1 && str.charCodeAt(i - 1) == 45) {
                    if (/\w/.test(str.charAt(i - 2)) && /[^\-?\.]/.test(str.charAt(i))) return true;
                    if (i > 2 && /[\d\.,]/.test(str.charAt(i - 2)) && /[\d\.,]/.test(str.charAt(i))) return false;
                }
                return /[~!#%&*)=+}\]|\"\.>,:;][({[<]|-[^\-?\.\u2010-\u201f\u2026]|\?[\w~`@#$%\^&*(_=+{[|><]|…[\w~`@#$%\^&*(_=+{[><]/.test(str.slice(i - 1, i + 1));
            };

        var knownScrollbarWidth;
        function scrollbarWidth(measure) {
            if (knownScrollbarWidth != null) return knownScrollbarWidth;
            var test = elt("div", null, null, "width: 50px; height: 50px; overflow-x: scroll");
            removeChildrenAndAdd(measure, test);
            if (test.offsetWidth)
                knownScrollbarWidth = test.offsetHeight - test.clientHeight;
            return knownScrollbarWidth || 0;
        }

        var zwspSupported;
        function zeroWidthElement(measure) {
            if (zwspSupported == null) {
                var test = elt("span", "\u200b");
                removeChildrenAndAdd(measure, elt("span", [test, document.createTextNode("x")]));
                if (measure.firstChild.offsetHeight != 0)
                    zwspSupported = test.offsetWidth <= 1 && test.offsetHeight > 2 && !ie_lt8;
            }
            if (zwspSupported) return elt("span", "\u200b");
            else return elt("span", "\u00a0", null, "display: inline-block; width: 1px; margin-right: -1px");
        }

        // See if "".split is the broken IE version, if so, provide an
        // alternative way to split lines.
        var splitLines = "\n\nb".split(/\n/).length != 3 ? function(string) {
            var pos = 0, result = [], l = string.length;
            while (pos <= l) {
                var nl = string.indexOf("\n", pos);
                if (nl == -1) nl = string.length;
                var line = string.slice(pos, string.charAt(nl - 1) == "\r" ? nl - 1 : nl);
                var rt = line.indexOf("\r");
                if (rt != -1) {
                    result.push(line.slice(0, rt));
                    pos += rt + 1;
                } else {
                    result.push(line);
                    pos = nl + 1;
                }
            }
            return result;
        } : function(string){return string.split(/\r\n?|\n/);};
        CodeMirror.splitLines = splitLines;

        var hasSelection = window.getSelection ? function(te) {
            try { return te.selectionStart != te.selectionEnd; }
            catch(e) { return false; }
        } : function(te) {
            try {var range = te.ownerDocument.selection.createRange();}
            catch(e) {}
            if (!range || range.parentElement() != te) return false;
            return range.compareEndPoints("StartToEnd", range) != 0;
        };

        var hasCopyEvent = (function() {
            var e = elt("div");
            if ("oncopy" in e) return true;
            e.setAttribute("oncopy", "return;");
            return typeof e.oncopy == 'function';
        })();

        // KEY NAMING

        var keyNames = {3: "Enter", 8: "Backspace", 9: "Tab", 13: "Enter", 16: "Shift", 17: "Ctrl", 18: "Alt",
            19: "Pause", 20: "CapsLock", 27: "Esc", 32: "Space", 33: "PageUp", 34: "PageDown", 35: "End",
            36: "Home", 37: "Left", 38: "Up", 39: "Right", 40: "Down", 44: "PrintScrn", 45: "Insert",
            46: "Delete", 59: ";", 91: "Mod", 92: "Mod", 93: "Mod", 109: "-", 107: "=", 127: "Delete",
            186: ";", 187: "=", 188: ",", 189: "-", 190: ".", 191: "/", 192: "`", 219: "[", 220: "\\",
            221: "]", 222: "'", 63276: "PageUp", 63277: "PageDown", 63275: "End", 63273: "Home",
            63234: "Left", 63232: "Up", 63235: "Right", 63233: "Down", 63302: "Insert", 63272: "Delete"};
        CodeMirror.keyNames = keyNames;
        (function() {
            // Number keys
            for (var i = 0; i < 10; i++) keyNames[i + 48] = String(i);
            // Alphabetic keys
            for (var i = 65; i <= 90; i++) keyNames[i] = String.fromCharCode(i);
            // Function keys
            for (var i = 1; i <= 12; i++) keyNames[i + 111] = keyNames[i + 63235] = "F" + i;
        })();

        // BIDI HELPERS

        function iterateBidiSections(order, from, to, f) {
            if (!order) return f(from, to, "ltr");
            var found = false;
            for (var i = 0; i < order.length; ++i) {
                var part = order[i];
                if (part.from < to && part.to > from || from == to && part.to == from) {
                    f(Math.max(part.from, from), Math.min(part.to, to), part.level == 1 ? "rtl" : "ltr");
                    found = true;
                }
            }
            if (!found) f(from, to, "ltr");
        }

        function bidiLeft(part) { return part.level % 2 ? part.to : part.from; }
        function bidiRight(part) { return part.level % 2 ? part.from : part.to; }

        function lineLeft(line) { var order = getOrder(line); return order ? bidiLeft(order[0]) : 0; }
        function lineRight(line) {
            var order = getOrder(line);
            if (!order) return line.text.length;
            return bidiRight(lst(order));
        }

        function lineStart(cm, lineN) {
            var line = getLine(cm.doc, lineN);
            var visual = visualLine(cm.doc, line);
            if (visual != line) lineN = lineNo(visual);
            var order = getOrder(visual);
            var ch = !order ? 0 : order[0].level % 2 ? lineRight(visual) : lineLeft(visual);
            return Pos(lineN, ch);
        }
        function lineEnd(cm, lineN) {
            var merged, line;
            while (merged = collapsedSpanAtEnd(line = getLine(cm.doc, lineN)))
                lineN = merged.find().to.line;
            var order = getOrder(line);
            var ch = !order ? line.text.length : order[0].level % 2 ? lineLeft(line) : lineRight(line);
            return Pos(lineN, ch);
        }

        function compareBidiLevel(order, a, b) {
            var linedir = order[0].level;
            if (a == linedir) return true;
            if (b == linedir) return false;
            return a < b;
        }
        var bidiOther;
        function getBidiPartAt(order, pos) {
            for (var i = 0, found; i < order.length; ++i) {
                var cur = order[i];
                if (cur.from < pos && cur.to > pos) { bidiOther = null; return i; }
                if (cur.from == pos || cur.to == pos) {
                    if (found == null) {
                        found = i;
                    } else if (compareBidiLevel(order, cur.level, order[found].level)) {
                        bidiOther = found;
                        return i;
                    } else {
                        bidiOther = i;
                        return found;
                    }
                }
            }
            bidiOther = null;
            return found;
        }

        function moveInLine(line, pos, dir, byUnit) {
            if (!byUnit) return pos + dir;
            do pos += dir;
            while (pos > 0 && isExtendingChar.test(line.text.charAt(pos)));
            return pos;
        }

        // This is somewhat involved. It is needed in order to move
        // 'visually' through bi-directional text -- i.e., pressing left
        // should make the cursor go left, even when in RTL text. The
        // tricky part is the 'jumps', where RTL and LTR text touch each
        // other. This often requires the cursor offset to move more than
        // one unit, in order to visually move one unit.
        function moveVisually(line, start, dir, byUnit) {
            var bidi = getOrder(line);
            if (!bidi) return moveLogically(line, start, dir, byUnit);
            var pos = getBidiPartAt(bidi, start), part = bidi[pos];
            var target = moveInLine(line, start, part.level % 2 ? -dir : dir, byUnit);

            for (;;) {
                if (target > part.from && target < part.to) return target;
                if (target == part.from || target == part.to) {
                    if (getBidiPartAt(bidi, target) == pos) return target;
                    part = bidi[pos += dir];
                    return (dir > 0) == part.level % 2 ? part.to : part.from;
                } else {
                    part = bidi[pos += dir];
                    if (!part) return null;
                    if ((dir > 0) == part.level % 2)
                        target = moveInLine(line, part.to, -1, byUnit);
                    else
                        target = moveInLine(line, part.from, 1, byUnit);
                }
            }
        }

        function moveLogically(line, start, dir, byUnit) {
            var target = start + dir;
            if (byUnit) while (target > 0 && isExtendingChar.test(line.text.charAt(target))) target += dir;
            return target < 0 || target > line.text.length ? null : target;
        }

        // Bidirectional ordering algorithm
        // See http://unicode.org/reports/tr9/tr9-13.html for the algorithm
        // that this (partially) implements.

        // One-char codes used for character types:
        // L (L):   Left-to-Right
        // R (R):   Right-to-Left
        // r (AL):  Right-to-Left Arabic
        // 1 (EN):  European Number
        // + (ES):  European Number Separator
        // % (ET):  European Number Terminator
        // n (AN):  Arabic Number
        // , (CS):  Common Number Separator
        // m (NSM): Non-Spacing Mark
        // b (BN):  Boundary Neutral
        // s (B):   Paragraph Separator
        // t (S):   Segment Separator
        // w (WS):  Whitespace
        // N (ON):  Other Neutrals

        // Returns null if characters are ordered as they appear
        // (left-to-right), or an array of sections ({from, to, level}
        // objects) in the order in which they occur visually.
        var bidiOrdering = (function() {
            // Character types for codepoints 0 to 0xff
            var lowTypes = "bbbbbbbbbtstwsbbbbbbbbbbbbbbssstwNN%%%NNNNNN,N,N1111111111NNNNNNNLLLLLLLLLLLLLLLLLLLLLLLLLLNNNNNNLLLLLLLLLLLLLLLLLLLLLLLLLLNNNNbbbbbbsbbbbbbbbbbbbbbbbbbbbbbbbbb,N%%%%NNNNLNNNNN%%11NLNNN1LNNNNNLLLLLLLLLLLLLLLLLLLLLLLNLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLNLLLLLLLL";
            // Character types for codepoints 0x600 to 0x6ff
            var arabicTypes = "rrrrrrrrrrrr,rNNmmmmmmrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrmmmmmmmmmmmmmmrrrrrrrnnnnnnnnnn%nnrrrmrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrmmmmmmmmmmmmmmmmmmmNmmmmrrrrrrrrrrrrrrrrrr";
            function charType(code) {
                if (code <= 0xff) return lowTypes.charAt(code);
                else if (0x590 <= code && code <= 0x5f4) return "R";
                else if (0x600 <= code && code <= 0x6ff) return arabicTypes.charAt(code - 0x600);
                else if (0x700 <= code && code <= 0x8ac) return "r";
                else return "L";
            }

            var bidiRE = /[\u0590-\u05f4\u0600-\u06ff\u0700-\u08ac]/;
            var isNeutral = /[stwN]/, isStrong = /[LRr]/, countsAsLeft = /[Lb1n]/, countsAsNum = /[1n]/;
            // Browsers seem to always treat the boundaries of block elements as being L.
            var outerType = "L";

            return function(str) {
                if (!bidiRE.test(str)) return false;
                var len = str.length, types = [];
                for (var i = 0, type; i < len; ++i)
                    types.push(type = charType(str.charCodeAt(i)));

                // W1. Examine each non-spacing mark (NSM) in the level run, and
                // change the type of the NSM to the type of the previous
                // character. If the NSM is at the start of the level run, it will
                // get the type of sor.
                for (var i = 0, prev = outerType; i < len; ++i) {
                    var type = types[i];
                    if (type == "m") types[i] = prev;
                    else prev = type;
                }

                // W2. Search backwards from each instance of a European number
                // until the first strong type (R, L, AL, or sor) is found. If an
                // AL is found, change the type of the European number to Arabic
                // number.
                // W3. Change all ALs to R.
                for (var i = 0, cur = outerType; i < len; ++i) {
                    var type = types[i];
                    if (type == "1" && cur == "r") types[i] = "n";
                    else if (isStrong.test(type)) { cur = type; if (type == "r") types[i] = "R"; }
                }

                // W4. A single European separator between two European numbers
                // changes to a European number. A single common separator between
                // two numbers of the same type changes to that type.
                for (var i = 1, prev = types[0]; i < len - 1; ++i) {
                    var type = types[i];
                    if (type == "+" && prev == "1" && types[i+1] == "1") types[i] = "1";
                    else if (type == "," && prev == types[i+1] &&
                        (prev == "1" || prev == "n")) types[i] = prev;
                    prev = type;
                }

                // W5. A sequence of European terminators adjacent to European
                // numbers changes to all European numbers.
                // W6. Otherwise, separators and terminators change to Other
                // Neutral.
                for (var i = 0; i < len; ++i) {
                    var type = types[i];
                    if (type == ",") types[i] = "N";
                    else if (type == "%") {
                        for (var end = i + 1; end < len && types[end] == "%"; ++end) {}
                        var replace = (i && types[i-1] == "!") || (end < len - 1 && types[end] == "1") ? "1" : "N";
                        for (var j = i; j < end; ++j) types[j] = replace;
                        i = end - 1;
                    }
                }

                // W7. Search backwards from each instance of a European number
                // until the first strong type (R, L, or sor) is found. If an L is
                // found, then change the type of the European number to L.
                for (var i = 0, cur = outerType; i < len; ++i) {
                    var type = types[i];
                    if (cur == "L" && type == "1") types[i] = "L";
                    else if (isStrong.test(type)) cur = type;
                }

                // N1. A sequence of neutrals takes the direction of the
                // surrounding strong text if the text on both sides has the same
                // direction. European and Arabic numbers act as if they were R in
                // terms of their influence on neutrals. Start-of-level-run (sor)
                // and end-of-level-run (eor) are used at level run boundaries.
                // N2. Any remaining neutrals take the embedding direction.
                for (var i = 0; i < len; ++i) {
                    if (isNeutral.test(types[i])) {
                        for (var end = i + 1; end < len && isNeutral.test(types[end]); ++end) {}
                        var before = (i ? types[i-1] : outerType) == "L";
                        var after = (end < len - 1 ? types[end] : outerType) == "L";
                        var replace = before || after ? "L" : "R";
                        for (var j = i; j < end; ++j) types[j] = replace;
                        i = end - 1;
                    }
                }

                // Here we depart from the documented algorithm, in order to avoid
                // building up an actual levels array. Since there are only three
                // levels (0, 1, 2) in an implementation that doesn't take
                // explicit embedding into account, we can build up the order on
                // the fly, without following the level-based algorithm.
                var order = [], m;
                for (var i = 0; i < len;) {
                    if (countsAsLeft.test(types[i])) {
                        var start = i;
                        for (++i; i < len && countsAsLeft.test(types[i]); ++i) {}
                        order.push({from: start, to: i, level: 0});
                    } else {
                        var pos = i, at = order.length;
                        for (++i; i < len && types[i] != "L"; ++i) {}
                        for (var j = pos; j < i;) {
                            if (countsAsNum.test(types[j])) {
                                if (pos < j) order.splice(at, 0, {from: pos, to: j, level: 1});
                                var nstart = j;
                                for (++j; j < i && countsAsNum.test(types[j]); ++j) {}
                                order.splice(at, 0, {from: nstart, to: j, level: 2});
                                pos = j;
                            } else ++j;
                        }
                        if (pos < i) order.splice(at, 0, {from: pos, to: i, level: 1});
                    }
                }
                if (order[0].level == 1 && (m = str.match(/^\s+/))) {
                    order[0].from = m[0].length;
                    order.unshift({from: 0, to: m[0].length, level: 0});
                }
                if (lst(order).level == 1 && (m = str.match(/\s+$/))) {
                    lst(order).to -= m[0].length;
                    order.push({from: len - m[0].length, to: len, level: 0});
                }
                if (order[0].level != lst(order).level)
                    order.push({from: len, to: len, level: order[0].level});

                return order;
            };
        })();

        // THE END

        CodeMirror.version = "3.15.0";

        return CodeMirror;
    })();

    (function() {
        'use strict';

        var listRE = /^(\s*)([*+-]|(\d+)\.)(\s*)/,
            unorderedBullets = '*+-';

        CodeMirror.commands.newlineAndIndentContinueMarkdownList = function(cm) {
            var pos = cm.getCursor(),
                inList = cm.getStateAfter(pos.line).list,
                match;

            if (!inList || !(match = cm.getLine(pos.line).match(listRE))) {
                cm.execCommand('newlineAndIndent');
                return;
            }

            var indent = match[1], after = match[4];
            var bullet = unorderedBullets.indexOf(match[2]) >= 0
                ? match[2]
                : (parseInt(match[3], 10) + 1) + '.';

            cm.replaceSelection('\n' + indent + bullet + after, 'end');
        };

    }());

    CodeMirror.defineMode("xml", function(config, parserConfig) {
        var indentUnit = config.indentUnit;
        var multilineTagIndentFactor = parserConfig.multilineTagIndentFactor || 1;
        var multilineTagIndentPastTag = parserConfig.multilineTagIndentPastTag || true;

        var Kludges = parserConfig.htmlMode ? {
            autoSelfClosers: {'area': true, 'base': true, 'br': true, 'col': true, 'command': true,
                'embed': true, 'frame': true, 'hr': true, 'img': true, 'input': true,
                'keygen': true, 'link': true, 'meta': true, 'param': true, 'source': true,
                'track': true, 'wbr': true},
            implicitlyClosed: {'dd': true, 'li': true, 'optgroup': true, 'option': true, 'p': true,
                'rp': true, 'rt': true, 'tbody': true, 'td': true, 'tfoot': true,
                'th': true, 'tr': true},
            contextGrabbers: {
                'dd': {'dd': true, 'dt': true},
                'dt': {'dd': true, 'dt': true},
                'li': {'li': true},
                'option': {'option': true, 'optgroup': true},
                'optgroup': {'optgroup': true},
                'p': {'address': true, 'article': true, 'aside': true, 'blockquote': true, 'dir': true,
                    'div': true, 'dl': true, 'fieldset': true, 'footer': true, 'form': true,
                    'h1': true, 'h2': true, 'h3': true, 'h4': true, 'h5': true, 'h6': true,
                    'header': true, 'hgroup': true, 'hr': true, 'menu': true, 'nav': true, 'ol': true,
                    'p': true, 'pre': true, 'section': true, 'table': true, 'ul': true},
                'rp': {'rp': true, 'rt': true},
                'rt': {'rp': true, 'rt': true},
                'tbody': {'tbody': true, 'tfoot': true},
                'td': {'td': true, 'th': true},
                'tfoot': {'tbody': true},
                'th': {'td': true, 'th': true},
                'thead': {'tbody': true, 'tfoot': true},
                'tr': {'tr': true}
            },
            doNotIndent: {"pre": true},
            allowUnquoted: true,
            allowMissing: true
        } : {
            autoSelfClosers: {},
            implicitlyClosed: {},
            contextGrabbers: {},
            doNotIndent: {},
            allowUnquoted: false,
            allowMissing: false
        };
        var alignCDATA = parserConfig.alignCDATA;

        // Return variables for tokenizers
        var tagName, type;

        function inText(stream, state) {
            function chain(parser) {
                state.tokenize = parser;
                return parser(stream, state);
            }

            var ch = stream.next();
            if (ch == "<") {
                if (stream.eat("!")) {
                    if (stream.eat("[")) {
                        if (stream.match("CDATA[")) return chain(inBlock("atom", "]]>"));
                        else return null;
                    } else if (stream.match("--")) {
                        return chain(inBlock("comment", "-->"));
                    } else if (stream.match("DOCTYPE", true, true)) {
                        stream.eatWhile(/[\w\._\-]/);
                        return chain(doctype(1));
                    } else {
                        return null;
                    }
                } else if (stream.eat("?")) {
                    stream.eatWhile(/[\w\._\-]/);
                    state.tokenize = inBlock("meta", "?>");
                    return "meta";
                } else {
                    var isClose = stream.eat("/");
                    tagName = "";
                    var c;
                    while ((c = stream.eat(/[^\s\u00a0=<>\"\'\/?]/))) tagName += c;
                    if (!tagName) return "error";
                    type = isClose ? "closeTag" : "openTag";
                    state.tokenize = inTag;
                    return "tag";
                }
            } else if (ch == "&") {
                var ok;
                if (stream.eat("#")) {
                    if (stream.eat("x")) {
                        ok = stream.eatWhile(/[a-fA-F\d]/) && stream.eat(";");
                    } else {
                        ok = stream.eatWhile(/[\d]/) && stream.eat(";");
                    }
                } else {
                    ok = stream.eatWhile(/[\w\.\-:]/) && stream.eat(";");
                }
                return ok ? "atom" : "error";
            } else {
                stream.eatWhile(/[^&<]/);
                return null;
            }
        }

        function inTag(stream, state) {
            var ch = stream.next();
            if (ch == ">" || (ch == "/" && stream.eat(">"))) {
                state.tokenize = inText;
                type = ch == ">" ? "endTag" : "selfcloseTag";
                return "tag";
            } else if (ch == "=") {
                type = "equals";
                return null;
            } else if (ch == "<") {
                return "error";
            } else if (/[\'\"]/.test(ch)) {
                state.tokenize = inAttribute(ch);
                state.stringStartCol = stream.column();
                return state.tokenize(stream, state);
            } else {
                stream.eatWhile(/[^\s\u00a0=<>\"\']/);
                return "word";
            }
        }

        function inAttribute(quote) {
            var closure = function(stream, state) {
                while (!stream.eol()) {
                    if (stream.next() == quote) {
                        state.tokenize = inTag;
                        break;
                    }
                }
                return "string";
            };
            closure.isInAttribute = true;
            return closure;
        }

        function inBlock(style, terminator) {
            return function(stream, state) {
                while (!stream.eol()) {
                    if (stream.match(terminator)) {
                        state.tokenize = inText;
                        break;
                    }
                    stream.next();
                }
                return style;
            };
        }
        function doctype(depth) {
            return function(stream, state) {
                var ch;
                while ((ch = stream.next()) != null) {
                    if (ch == "<") {
                        state.tokenize = doctype(depth + 1);
                        return state.tokenize(stream, state);
                    } else if (ch == ">") {
                        if (depth == 1) {
                            state.tokenize = inText;
                            break;
                        } else {
                            state.tokenize = doctype(depth - 1);
                            return state.tokenize(stream, state);
                        }
                    }
                }
                return "meta";
            };
        }

        var curState, curStream, setStyle;
        function pass() {
            for (var i = arguments.length - 1; i >= 0; i--) curState.cc.push(arguments[i]);
        }
        function cont() {
            pass.apply(null, arguments);
            return true;
        }

        function pushContext(tagName, startOfLine) {
            var noIndent = Kludges.doNotIndent.hasOwnProperty(tagName) || (curState.context && curState.context.noIndent);
            curState.context = {
                prev: curState.context,
                tagName: tagName,
                indent: curState.indented,
                startOfLine: startOfLine,
                noIndent: noIndent
            };
        }
        function popContext() {
            if (curState.context) curState.context = curState.context.prev;
        }

        function element(type) {
            if (type == "openTag") {
                curState.tagName = tagName;
                curState.tagStart = curStream.column();
                return cont(attributes, endtag(curState.startOfLine));
            } else if (type == "closeTag") {
                var err = false;
                if (curState.context) {
                    if (curState.context.tagName != tagName) {
                        if (Kludges.implicitlyClosed.hasOwnProperty(curState.context.tagName.toLowerCase())) {
                            popContext();
                        }
                        err = !curState.context || curState.context.tagName != tagName;
                    }
                } else {
                    err = true;
                }
                if (err) setStyle = "error";
                return cont(endclosetag(err));
            }
            return cont();
        }
        function endtag(startOfLine) {
            return function(type) {
                var tagName = curState.tagName;
                curState.tagName = curState.tagStart = null;
                if (type == "selfcloseTag" ||
                    (type == "endTag" && Kludges.autoSelfClosers.hasOwnProperty(tagName.toLowerCase()))) {
                    maybePopContext(tagName.toLowerCase());
                    return cont();
                }
                if (type == "endTag") {
                    maybePopContext(tagName.toLowerCase());
                    pushContext(tagName, startOfLine);
                    return cont();
                }
                return cont();
            };
        }
        function endclosetag(err) {
            return function(type) {
                if (err) setStyle = "error";
                if (type == "endTag") { popContext(); return cont(); }
                setStyle = "error";
                return cont(arguments.callee);
            };
        }
        function maybePopContext(nextTagName) {
            var parentTagName;
            while (true) {
                if (!curState.context) {
                    return;
                }
                parentTagName = curState.context.tagName.toLowerCase();
                if (!Kludges.contextGrabbers.hasOwnProperty(parentTagName) ||
                    !Kludges.contextGrabbers[parentTagName].hasOwnProperty(nextTagName)) {
                    return;
                }
                popContext();
            }
        }

        function attributes(type) {
            if (type == "word") {setStyle = "attribute"; return cont(attribute, attributes);}
            if (type == "endTag" || type == "selfcloseTag") return pass();
            setStyle = "error";
            return cont(attributes);
        }
        function attribute(type) {
            if (type == "equals") return cont(attvalue, attributes);
            if (!Kludges.allowMissing) setStyle = "error";
            else if (type == "word") setStyle = "attribute";
            return (type == "endTag" || type == "selfcloseTag") ? pass() : cont();
        }
        function attvalue(type) {
            if (type == "string") return cont(attvaluemaybe);
            if (type == "word" && Kludges.allowUnquoted) {setStyle = "string"; return cont();}
            setStyle = "error";
            return (type == "endTag" || type == "selfCloseTag") ? pass() : cont();
        }
        function attvaluemaybe(type) {
            if (type == "string") return cont(attvaluemaybe);
            else return pass();
        }

        return {
            startState: function() {
                return {tokenize: inText, cc: [], indented: 0, startOfLine: true, tagName: null, tagStart: null, context: null};
            },

            token: function(stream, state) {
                if (!state.tagName && stream.sol()) {
                    state.startOfLine = true;
                    state.indented = stream.indentation();
                }
                if (stream.eatSpace()) return null;

                setStyle = type = tagName = null;
                var style = state.tokenize(stream, state);
                state.type = type;
                if ((style || type) && style != "comment") {
                    curState = state; curStream = stream;
                    while (true) {
                        var comb = state.cc.pop() || element;
                        if (comb(type || style)) break;
                    }
                }
                state.startOfLine = false;
                return setStyle || style;
            },

            indent: function(state, textAfter, fullLine) {
                var context = state.context;
                // Indent multi-line strings (e.g. css).
                if (state.tokenize.isInAttribute) {
                    return state.stringStartCol + 1;
                }
                if ((state.tokenize != inTag && state.tokenize != inText) ||
                    context && context.noIndent)
                    return fullLine ? fullLine.match(/^(\s*)/)[0].length : 0;
                // Indent the starts of attribute names.
                if (state.tagName) {
                    if (multilineTagIndentPastTag)
                        return state.tagStart + state.tagName.length + 2;
                    else
                        return state.tagStart + indentUnit * multilineTagIndentFactor;
                }
                if (alignCDATA && /<!\[CDATA\[/.test(textAfter)) return 0;
                if (context && /^<\//.test(textAfter))
                    context = context.prev;
                while (context && !context.startOfLine)
                    context = context.prev;
                if (context) return context.indent + indentUnit;
                else return 0;
            },

            electricChars: "/",
            blockCommentStart: "<!--",
            blockCommentEnd: "-->",

            configuration: parserConfig.htmlMode ? "html" : "xml",
            helperType: parserConfig.htmlMode ? "html" : "xml"
        };
    });

    CodeMirror.defineMIME("text/xml", "xml");
    CodeMirror.defineMIME("application/xml", "xml");
    if (!CodeMirror.mimeModes.hasOwnProperty("text/html"))
        CodeMirror.defineMIME("text/html", {name: "xml", htmlMode: true});

    CodeMirror.defineMode("markdown", function(cmCfg, modeCfg) {

        var htmlFound = CodeMirror.modes.hasOwnProperty("xml");
        var htmlMode = CodeMirror.getMode(cmCfg, htmlFound ? {name: "xml", htmlMode: true} : "text/plain");
        var aliases = {
            html: "htmlmixed",
            js: "javascript",
            json: "application/json",
            c: "text/x-csrc",
            "c++": "text/x-c++src",
            java: "text/x-java",
            csharp: "text/x-csharp",
            "c#": "text/x-csharp",
            scala: "text/x-scala"
        };

        var getMode = (function () {
            var i, modes = {}, mimes = {}, mime;

            var list = [];
            for (var m in CodeMirror.modes)
                if (CodeMirror.modes.propertyIsEnumerable(m)) list.push(m);
            for (i = 0; i < list.length; i++) {
                modes[list[i]] = list[i];
            }
            var mimesList = [];
            for (var m in CodeMirror.mimeModes)
                if (CodeMirror.mimeModes.propertyIsEnumerable(m))
                    mimesList.push({mime: m, mode: CodeMirror.mimeModes[m]});
            for (i = 0; i < mimesList.length; i++) {
                mime = mimesList[i].mime;
                mimes[mime] = mimesList[i].mime;
            }

            for (var a in aliases) {
                if (aliases[a] in modes || aliases[a] in mimes)
                    modes[a] = aliases[a];
            }

            return function (lang) {
                return modes[lang] ? CodeMirror.getMode(cmCfg, modes[lang]) : null;
            };
        }());

        // Should underscores in words open/close em/strong?
        if (modeCfg.underscoresBreakWords === undefined)
            modeCfg.underscoresBreakWords = true;

        // Turn on fenced code blocks? ("```" to start/end)
        if (modeCfg.fencedCodeBlocks === undefined) modeCfg.fencedCodeBlocks = false;

        // Turn on task lists? ("- [ ] " and "- [x] ")
        if (modeCfg.taskLists === undefined) modeCfg.taskLists = false;

        var codeDepth = 0;

        var header   = 'header'
            ,   code     = 'comment'
            ,   quote1   = 'atom'
            ,   quote2   = 'number'
            ,   list1    = 'variable-2'
            ,   list2    = 'variable-3'
            ,   list3    = 'keyword'
            ,   hr       = 'hr'
            ,   image    = 'tag'
            ,   linkinline = 'link'
            ,   linkemail = 'link'
            ,   linktext = 'link'
            ,   linkhref = 'string'
            ,   em       = 'em'
            ,   strong   = 'strong';

        var hrRE = /^([*\-=_])(?:\s*\1){2,}\s*$/
            ,   ulRE = /^[*\-+]\s+/
            ,   olRE = /^[0-9]+\.\s+/
            ,   taskListRE = /^\[(x| )\](?=\s)/ // Must follow ulRE or olRE
            ,   headerRE = /^(?:\={1,}|-{1,})$/
            ,   textRE = /^[^!\[\]*_\\<>` "'(]+/;

        function switchInline(stream, state, f) {
            state.f = state.inline = f;
            return f(stream, state);
        }

        function switchBlock(stream, state, f) {
            state.f = state.block = f;
            return f(stream, state);
        }


        // Blocks

        function blankLine(state) {
            // Reset linkTitle state
            state.linkTitle = false;
            // Reset EM state
            state.em = false;
            // Reset STRONG state
            state.strong = false;
            // Reset state.quote
            state.quote = 0;
            if (!htmlFound && state.f == htmlBlock) {
                state.f = inlineNormal;
                state.block = blockNormal;
            }
            // Reset state.trailingSpace
            state.trailingSpace = 0;
            state.trailingSpaceNewLine = false;
            // Mark this line as blank
            state.thisLineHasContent = false;
            return null;
        }

        function blockNormal(stream, state) {

            var prevLineIsList = (state.list !== false);
            if (state.list !== false && state.indentationDiff >= 0) { // Continued list
                if (state.indentationDiff < 4) { // Only adjust indentation if *not* a code block
                    state.indentation -= state.indentationDiff;
                }
                state.list = null;
            } else if (state.list !== false && state.indentation > 0) {
                state.list = null;
                state.listDepth = Math.floor(state.indentation / 4);
            } else if (state.list !== false) { // No longer a list
                state.list = false;
                state.listDepth = 0;
            }

            if (state.indentationDiff >= 4) {
                state.indentation -= 4;
                stream.skipToEnd();
                return code;
            } else if (stream.eatSpace()) {
                return null;
            } else if (stream.peek() === '#' || (state.prevLineHasContent && stream.match(headerRE)) ) {
                state.header = true;
            } else if (stream.eat('>')) {
                state.indentation++;
                state.quote = 1;
                stream.eatSpace();
                while (stream.eat('>')) {
                    stream.eatSpace();
                    state.quote++;
                }
            } else if (stream.peek() === '[') {
                return switchInline(stream, state, footnoteLink);
            } else if (stream.match(hrRE, true)) {
                return hr;
            } else if ((!state.prevLineHasContent || prevLineIsList) && (stream.match(ulRE, true) || stream.match(olRE, true))) {
                state.indentation += 4;
                state.list = true;
                state.listDepth++;
                if (modeCfg.taskLists && stream.match(taskListRE, false)) {
                    state.taskList = true;
                }
            } else if (modeCfg.fencedCodeBlocks && stream.match(/^```([\w+#]*)/, true)) {
                // try switching mode
                state.localMode = getMode(RegExp.$1);
                if (state.localMode) state.localState = state.localMode.startState();
                switchBlock(stream, state, local);
                return code;
            }

            return switchInline(stream, state, state.inline);
        }

        function htmlBlock(stream, state) {
            var style = htmlMode.token(stream, state.htmlState);
            if (htmlFound && style === 'tag' && state.htmlState.type !== 'openTag' && !state.htmlState.context) {
                state.f = inlineNormal;
                state.block = blockNormal;
            }
            if (state.md_inside && stream.current().indexOf(">")!=-1) {
                state.f = inlineNormal;
                state.block = blockNormal;
                state.htmlState.context = undefined;
            }
            return style;
        }

        function local(stream, state) {
            if (stream.sol() && stream.match(/^```/, true)) {
                state.localMode = state.localState = null;
                state.f = inlineNormal;
                state.block = blockNormal;
                return code;
            } else if (state.localMode) {
                return state.localMode.token(stream, state.localState);
            } else {
                stream.skipToEnd();
                return code;
            }
        }

        // Inline
        function getType(state) {
            var styles = [];

            if (state.taskOpen) { return "meta"; }
            if (state.taskClosed) { return "property"; }

            if (state.strong) { styles.push(strong); }
            if (state.em) { styles.push(em); }

            if (state.linkText) { styles.push(linktext); }

            if (state.code) { styles.push(code); }

            if (state.header) { styles.push(header); }
            if (state.quote) { styles.push(state.quote % 2 ? quote1 : quote2); }
            if (state.list !== false) {
                var listMod = (state.listDepth - 1) % 3;
                if (!listMod) {
                    styles.push(list1);
                } else if (listMod === 1) {
                    styles.push(list2);
                } else {
                    styles.push(list3);
                }
            }

            if (state.trailingSpaceNewLine) {
                styles.push("trailing-space-new-line");
            } else if (state.trailingSpace) {
                styles.push("trailing-space-" + (state.trailingSpace % 2 ? "a" : "b"));
            }

            return styles.length ? styles.join(' ') : null;
        }

        function handleText(stream, state) {
            if (stream.match(textRE, true)) {
                return getType(state);
            }
            return undefined;
        }

        function inlineNormal(stream, state) {
            var style = state.text(stream, state);
            if (typeof style !== 'undefined')
                return style;

            if (state.list) { // List marker (*, +, -, 1., etc)
                state.list = null;
                return getType(state);
            }

            if (state.taskList) {
                var taskOpen = stream.match(taskListRE, true)[1] !== "x";
                if (taskOpen) state.taskOpen = true;
                else state.taskClosed = true;
                state.taskList = false;
                return getType(state);
            }

            state.taskOpen = false;
            state.taskClosed = false;

            var ch = stream.next();

            if (ch === '\\') {
                stream.next();
                return getType(state);
            }

            // Matches link titles present on next line
            if (state.linkTitle) {
                state.linkTitle = false;
                var matchCh = ch;
                if (ch === '(') {
                    matchCh = ')';
                }
                matchCh = (matchCh+'').replace(/([.?*+^$[\]\\(){}|-])/g, "\\$1");
                var regex = '^\\s*(?:[^' + matchCh + '\\\\]+|\\\\\\\\|\\\\.)' + matchCh;
                if (stream.match(new RegExp(regex), true)) {
                    return linkhref;
                }
            }

            // If this block is changed, it may need to be updated in GFM mode
            if (ch === '`') {
                var t = getType(state);
                var before = stream.pos;
                stream.eatWhile('`');
                var difference = 1 + stream.pos - before;
                if (!state.code) {
                    codeDepth = difference;
                    state.code = true;
                    return getType(state);
                } else {
                    if (difference === codeDepth) { // Must be exact
                        state.code = false;
                        return t;
                    }
                    return getType(state);
                }
            } else if (state.code) {
                return getType(state);
            }

            if (ch === '!' && stream.match(/\[[^\]]*\] ?(?:\(|\[)/, false)) {
                stream.match(/\[[^\]]*\]/);
                state.inline = state.f = linkHref;
                return image;
            }

            if (ch === '[' && stream.match(/.*\](\(| ?\[)/, false)) {
                state.linkText = true;
                return getType(state);
            }

            if (ch === ']' && state.linkText) {
                var type = getType(state);
                state.linkText = false;
                state.inline = state.f = linkHref;
                return type;
            }

            if (ch === '<' && stream.match(/^(https?|ftps?):\/\/(?:[^\\>]|\\.)+>/, false)) {
                return switchInline(stream, state, inlineElement(linkinline, '>'));
            }

            if (ch === '<' && stream.match(/^[^> \\]+@(?:[^\\>]|\\.)+>/, false)) {
                return switchInline(stream, state, inlineElement(linkemail, '>'));
            }

            if (ch === '<' && stream.match(/^\w/, false)) {
                if (stream.string.indexOf(">")!=-1) {
                    var atts = stream.string.substring(1,stream.string.indexOf(">"));
                    if (/markdown\s*=\s*('|"){0,1}1('|"){0,1}/.test(atts)) {
                        state.md_inside = true;
                    }
                }
                stream.backUp(1);
                return switchBlock(stream, state, htmlBlock);
            }

            if (ch === '<' && stream.match(/^\/\w*?>/)) {
                state.md_inside = false;
                return "tag";
            }

            var ignoreUnderscore = false;
            if (!modeCfg.underscoresBreakWords) {
                if (ch === '_' && stream.peek() !== '_' && stream.match(/(\w)/, false)) {
                    var prevPos = stream.pos - 2;
                    if (prevPos >= 0) {
                        var prevCh = stream.string.charAt(prevPos);
                        if (prevCh !== '_' && prevCh.match(/(\w)/, false)) {
                            ignoreUnderscore = true;
                        }
                    }
                }
            }
            var t = getType(state);
            if (ch === '*' || (ch === '_' && !ignoreUnderscore)) {
                if (state.strong === ch && stream.eat(ch)) { // Remove STRONG
                    state.strong = false;
                    return t;
                } else if (!state.strong && stream.eat(ch)) { // Add STRONG
                    state.strong = ch;
                    return getType(state);
                } else if (state.em === ch) { // Remove EM
                    state.em = false;
                    return t;
                } else if (!state.em) { // Add EM
                    state.em = ch;
                    return getType(state);
                }
            } else if (ch === ' ') {
                if (stream.eat('*') || stream.eat('_')) { // Probably surrounded by spaces
                    if (stream.peek() === ' ') { // Surrounded by spaces, ignore
                        return getType(state);
                    } else { // Not surrounded by spaces, back up pointer
                        stream.backUp(1);
                    }
                }
            }

            if (ch === ' ') {
                if (stream.match(/ +$/, false)) {
                    state.trailingSpace++;
                } else if (state.trailingSpace) {
                    state.trailingSpaceNewLine = true;
                }
            }

            return getType(state);
        }

        function linkHref(stream, state) {
            // Check if space, and return NULL if so (to avoid marking the space)
            if(stream.eatSpace()){
                return null;
            }
            var ch = stream.next();
            if (ch === '(' || ch === '[') {
                return switchInline(stream, state, inlineElement(linkhref, ch === '(' ? ')' : ']'));
            }
            return 'error';
        }

        function footnoteLink(stream, state) {
            if (stream.match(/^[^\]]*\]:/, true)) {
                state.f = footnoteUrl;
                return linktext;
            }
            return switchInline(stream, state, inlineNormal);
        }

        function footnoteUrl(stream, state) {
            // Check if space, and return NULL if so (to avoid marking the space)
            if(stream.eatSpace()){
                return null;
            }
            // Match URL
            stream.match(/^[^\s]+/, true);
            // Check for link title
            if (stream.peek() === undefined) { // End of line, set flag to check next line
                state.linkTitle = true;
            } else { // More content on line, check if link title
                stream.match(/^(?:\s+(?:"(?:[^"\\]|\\\\|\\.)+"|'(?:[^'\\]|\\\\|\\.)+'|\((?:[^)\\]|\\\\|\\.)+\)))?/, true);
            }
            state.f = state.inline = inlineNormal;
            return linkhref;
        }

        var savedInlineRE = [];
        function inlineRE(endChar) {
            if (!savedInlineRE[endChar]) {
                // Escape endChar for RegExp (taken from http://stackoverflow.com/a/494122/526741)
                endChar = (endChar+'').replace(/([.?*+^$[\]\\(){}|-])/g, "\\$1");
                // Match any non-endChar, escaped character, as well as the closing
                // endChar.
                savedInlineRE[endChar] = new RegExp('^(?:[^\\\\]|\\\\.)*?(' + endChar + ')');
            }
            return savedInlineRE[endChar];
        }

        function inlineElement(type, endChar, next) {
            next = next || inlineNormal;
            return function(stream, state) {
                stream.match(inlineRE(endChar));
                state.inline = state.f = next;
                return type;
            };
        }

        return {
            startState: function() {
                return {
                    f: blockNormal,

                    prevLineHasContent: false,
                    thisLineHasContent: false,

                    block: blockNormal,
                    htmlState: CodeMirror.startState(htmlMode),
                    indentation: 0,

                    inline: inlineNormal,
                    text: handleText,

                    linkText: false,
                    linkTitle: false,
                    em: false,
                    strong: false,
                    header: false,
                    taskList: false,
                    list: false,
                    listDepth: 0,
                    quote: 0,
                    trailingSpace: 0,
                    trailingSpaceNewLine: false
                };
            },

            copyState: function(s) {
                return {
                    f: s.f,

                    prevLineHasContent: s.prevLineHasContent,
                    thisLineHasContent: s.thisLineHasContent,

                    block: s.block,
                    htmlState: CodeMirror.copyState(htmlMode, s.htmlState),
                    indentation: s.indentation,

                    localMode: s.localMode,
                    localState: s.localMode ? CodeMirror.copyState(s.localMode, s.localState) : null,

                    inline: s.inline,
                    text: s.text,
                    linkTitle: s.linkTitle,
                    em: s.em,
                    strong: s.strong,
                    header: s.header,
                    taskList: s.taskList,
                    list: s.list,
                    listDepth: s.listDepth,
                    quote: s.quote,
                    trailingSpace: s.trailingSpace,
                    trailingSpaceNewLine: s.trailingSpaceNewLine,
                    md_inside: s.md_inside
                };
            },

            token: function(stream, state) {
                if (stream.sol()) {
                    if (stream.match(/^\s*$/, true)) {
                        state.prevLineHasContent = false;
                        return blankLine(state);
                    } else {
                        state.prevLineHasContent = state.thisLineHasContent;
                        state.thisLineHasContent = true;
                    }

                    // Reset state.header
                    state.header = false;

                    // Reset state.taskList
                    state.taskList = false;

                    // Reset state.code
                    state.code = false;

                    // Reset state.trailingSpace
                    state.trailingSpace = 0;
                    state.trailingSpaceNewLine = false;

                    state.f = state.block;
                    var indentation = stream.match(/^\s*/, true)[0].replace(/\t/g, '    ').length;
                    var difference = Math.floor((indentation - state.indentation) / 4) * 4;
                    if (difference > 4) difference = 4;
                    var adjustedIndentation = state.indentation + difference;
                    state.indentationDiff = adjustedIndentation - state.indentation;
                    state.indentation = adjustedIndentation;
                    if (indentation > 0) return null;
                }
                return state.f(stream, state);
            },

            blankLine: blankLine,

            getType: getType
        };

    }, "xml");

    CodeMirror.defineMIME("text/x-markdown", "markdown");


    var isMac = /Mac/.test(navigator.platform);

    var shortcuts = {
        'Cmd-B': toggleBold,
        'Cmd-I': toggleItalic,
        'Cmd-K': drawLink,
        'Cmd-Alt-I': drawImage,
        "Cmd-'": toggleBlockquote,
        'Cmd-Alt-L': toggleOrderedList,
        'Cmd-L': toggleUnOrderedList
    };


    /**
     * Fix shortcut. Mac use Command, others use Ctrl.
     */
    function fixShortcut(name) {
        if (isMac) {
            name = name.replace('Ctrl', 'Cmd');
        } else {
            name = name.replace('Cmd', 'Ctrl');
        }
        return name;
    }


    /**
     * Create icon element for toolbar.
     */
    function createIcon(name, options) {
        options = options || {};
        var el = document.createElement('a');

        var shortcut = options.shortcut || shortcuts[name];
        if (shortcut) {
            shortcut = fixShortcut(shortcut);
            el.title = shortcut;
            el.title = el.title.replace('Cmd', '⌘');
            if (isMac) {
                el.title = el.title.replace('Alt', '⌥');
            }
        }

        el.className = options.className || 'icon-' + name;
        return el;
    }

    function createSep() {
        el = document.createElement('i');
        el.className = 'separator';
        el.innerHTML = '|';
        return el;
    }


    /**
     * The state of CodeMirror at the given position.
     */
    function getState(cm, pos) {
        pos = pos || cm.getCursor('start');
        var stat = cm.getTokenAt(pos);
        if (!stat.type) return {};

        var types = stat.type.split(' ');

        var ret = {}, data, text;
        for (var i = 0; i < types.length; i++) {
            data = types[i];
            if (data === 'strong') {
                ret.bold = true;
            } else if (data === 'variable-2') {
                text = cm.getLine(pos.line);
                if (/^\s*\d+\.\s/.test(text)) {
                    ret['ordered-list'] = true;
                } else {
                    ret['unordered-list'] = true;
                }
            } else if (data === 'atom') {
                ret.quote = true;
            } else if (data === 'em') {
                ret.italic = true;
            }
        }
        return ret;
    }


    /**
     * Toggle full screen of the editor.
     */
    function toggleFullScreen(editor) {
        var el = editor.codemirror.getWrapperElement();

        // https://developer.mozilla.org/en-US/docs/DOM/Using_fullscreen_mode
        var doc = document;
        var isFull = doc.fullScreen || doc.mozFullScreen || doc.webkitFullScreen;
        var request = function() {
            if (el.requestFullScreen) {
                el.requestFullScreen();
            } else if (el.mozRequestFullScreen) {
                el.mozRequestFullScreen();
            } else if (el.webkitRequestFullScreen) {
                el.webkitRequestFullScreen(Element.ALLOW_KEYBOARD_INPUT);
            }
        };
        var cancel = function() {
            if (doc.cancelFullScreen) {
                doc.cancelFullScreen();
            } else if (doc.mozCancelFullScreen) {
                doc.mozCancelFullScreen();
            } else if (doc.webkitCancelFullScreen) {
                doc.webkitCancelFullScreen();
            }
        };
        if (!isFull) {
            request();
        } else if (cancel) {
            cancel();
        }
    }


    /**
     * Action for toggling bold.
     */
    function toggleBold(editor) {
        debugger
        var cm = editor.codemirror;
        var stat = getState(cm);

        var text;
        var start = '**';
        var end = '**';

        var startPoint = cm.getCursor('start');
        var endPoint = cm.getCursor('end');
        if (stat.bold) {
            text = cm.getLine(startPoint.line);
            start = text.slice(0, startPoint.ch);
            end = text.slice(startPoint.ch);

            start = start.replace(/^(.*)?(\*|\_){2}(\S+.*)?$/, '$1$3');
            end = end.replace(/^(.*\S+)?(\*|\_){2}(\s+.*)?$/, '$1$3');
            startPoint.ch -= 2;
            endPoint.ch -= 2;
            cm.setLine(startPoint.line, start + end);
        } else {
            text = cm.getSelection();
            cm.replaceSelection(start + text + end);

            startPoint.ch += 2;
            endPoint.ch += 2;
        }
        cm.setSelection(startPoint, endPoint);
        cm.focus();
    }


    /**
     * Action for toggling italic.
     */
    function toggleItalic(editor) {
        var cm = editor.codemirror;
        var stat = getState(cm);

        var text;
        var start = '*';
        var end = '*';

        var startPoint = cm.getCursor('start');
        var endPoint = cm.getCursor('end');
        if (stat.italic) {
            text = cm.getLine(startPoint.line);
            start = text.slice(0, startPoint.ch);
            end = text.slice(startPoint.ch);

            start = start.replace(/^(.*)?(\*|\_)(\S+.*)?$/, '$1$3');
            end = end.replace(/^(.*\S+)?(\*|\_)(\s+.*)?$/, '$1$3');
            startPoint.ch -= 1;
            endPoint.ch -= 1;
            cm.setLine(startPoint.line, start + end);
        } else {
            text = cm.getSelection();
            cm.replaceSelection(start + text + end);

            startPoint.ch += 1;
            endPoint.ch += 1;
        }
        cm.setSelection(startPoint, endPoint);
        cm.focus();
    }


    /**
     * Action for toggling blockquote.
     */
    function toggleBlockquote(editor) {
        var cm = editor.codemirror;
        _toggleLine(cm, 'quote');
    }


    /**
     * Action for toggling ul.
     */
    function toggleUnOrderedList(editor) {
        var cm = editor.codemirror;
        _toggleLine(cm, 'unordered-list');
    }


    /**
     * Action for toggling ol.
     */
    function toggleOrderedList(editor) {
        var cm = editor.codemirror;
        _toggleLine(cm, 'ordered-list');
    }


    /**
     * Action for drawing a link.
     */
    function drawLink(editor) {
        var cm = editor.codemirror;
        var stat = getState(cm);
        _replaceSelection(cm, stat.link, '[', '](http://)');
    }


    /**
     * Action for drawing an img.
     */
    function drawImage(editor) {
        var cm = editor.codemirror;
        var stat = getState(cm);
        _replaceSelection(cm, stat.image, '![', '](http://)');
    }


    /**
     * Undo action.
     */
    function undo(editor) {
        var cm = editor.codemirror;
        cm.undo();
        cm.focus();
    }


    /**
     * Redo action.
     */
    function redo(editor) {
        var cm = editor.codemirror;
        cm.redo();
        cm.focus();
    }

    /**
     * Preview action.
     */
    function togglePreview(editor) {
        var toolbar = editor.toolbar.preview;
        var parse = editor.constructor.markdown;
        var cm = editor.codemirror;
        var wrapper = cm.getWrapperElement();
        var preview = wrapper.lastChild;
        if (!/editor-preview/.test(preview.className)) {
            preview = document.createElement('div');
            preview.className = 'editor-preview';
            wrapper.appendChild(preview);
        }
        if (/editor-preview-active/.test(preview.className)) {
            preview.className = preview.className.replace(
                /\s*editor-preview-active\s*/g, ''
            );
            toolbar.className = toolbar.className.replace(/\s*active\s*/g, '');
        } else {
            /* When the preview button is clicked for the first time,
             * give some time for the transition from editor.css to fire and the view to slide from right to left,
             * instead of just appearing.
             */
            setTimeout(function() {preview.className += ' editor-preview-active'}, 1);
            toolbar.className += ' active';
        }
        var text = cm.getValue();
        preview.innerHTML = parse(text);
    }

    function _replaceSelection(cm, active, start, end) {
        var text;
        var startPoint = cm.getCursor('start');
        var endPoint = cm.getCursor('end');
        if (active) {
            text = cm.getLine(startPoint.line);
            start = text.slice(0, startPoint.ch);
            end = text.slice(startPoint.ch);
            cm.setLine(startPoint.line, start + end);
        } else {
            text = cm.getSelection();
            cm.replaceSelection(start + text + end);

            startPoint.ch += start.length;
            endPoint.ch += start.length;
        }
        cm.setSelection(startPoint, endPoint);
        cm.focus();
    }


    function _toggleLine(cm, name) {
        var stat = getState(cm);
        var startPoint = cm.getCursor('start');
        var endPoint = cm.getCursor('end');
        var repl = {
            quote: /^(\s*)\>\s+/,
            'unordered-list': /^(\s*)(\*|\-|\+)\s+/,
            'ordered-list': /^(\s*)\d+\.\s+/
        };
        var map = {
            quote: '> ',
            'unordered-list': '* ',
            'ordered-list': '1. '
        };
        for (var i = startPoint.line; i <= endPoint.line; i++) {
            (function(i) {
                var text = cm.getLine(i);
                if (stat[name]) {
                    text = text.replace(repl[name], '$1');
                } else {
                    text = map[name] + text;
                }
                cm.setLine(i, text);
            })(i);
        }
        cm.focus();
    }


    /* The right word count in respect for CJK. */
    function wordCount(data) {
        var pattern = /[a-zA-Z0-9_\u0392-\u03c9]+|[\u4E00-\u9FFF\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\uac00-\ud7af]+/g;
        var m = data.match(pattern);
        var count = 0;
        if( m === null ) return count;
        for (var i = 0; i < m.length; i++) {
            if (m[i].charCodeAt(0) >= 0x4E00) {
                count += m[i].length;
            } else {
                count += 1;
            }
        }
        return count;
    }

    var toolbar = [
        {name: 'bold', action: toggleBold},
        {name: 'italic', action: toggleItalic},
        '|',

        {name: 'quote', action: toggleBlockquote},
        {name: 'unordered-list', action: toggleUnOrderedList},
        {name: 'ordered-list', action: toggleOrderedList},
        '|',

        {name: 'link', action: drawLink},
        {name: 'image', action: drawImage},
        '|',

        {name: 'info', action: 'http://lab.lepture.com/editor/markdown'},
        {name: 'preview', action: togglePreview},
        {name: 'fullscreen', action: toggleFullScreen}
    ];

    /**
     * Interface of Editor.
     */
    function Editor(options) {
        options = options || {};

        if (options.element) {
            this.element = options.element;
        }

        options.toolbar = options.toolbar || Editor.toolbar;
        // you can customize toolbar with object
        // [{name: 'bold', shortcut: 'Ctrl-B', className: 'icon-bold'}]

        if (!options.hasOwnProperty('status')) {
            options.status = ['lines', 'words', 'cursor'];
        }

        this.options = options;

        // If user has passed an element, it should auto rendered
        if (this.element) {
            this.render();
        }
    }

    /**
     * Default toolbar elements.
     */
    Editor.toolbar = toolbar;

    /**
     * Default markdown render.
     */
    Editor.markdown = function(text) {
        if (window.marked) {
            // use marked as markdown parser
            return marked(text);
        }
    };

    /**
     * Render editor to the given element.
     */
    Editor.prototype.render = function(el) {
        if (!el) {
            el = this.element || document.getElementsByTagName('textarea')[0];
        }

        if (this._rendered && this._rendered === el) {
            // Already rendered.
            return;
        }

        this.element = el;
        var options = this.options;

        var self = this;
        var keyMaps = {};

        for (var key in shortcuts) {
            (function(key) {
                keyMaps[fixShortcut(key)] = function(cm) {
                    shortcuts[key](self);
                };
            })(key);
        }

        keyMaps["Enter"] = "newlineAndIndentContinueMarkdownList";

        this.codemirror = CodeMirror.fromTextArea(el, {
            mode: 'markdown',
            theme: 'paper',
            indentWithTabs: true,
            lineNumbers: false,
            extraKeys: keyMaps
        });

        if (options.toolbar !== false) {
            this.createToolbar();
        }
        if (options.status !== false) {
            this.createStatusbar();
        }

        this._rendered = this.element;
    };

    Editor.prototype.createToolbar = function(items) {
        items = items || this.options.toolbar;

        if (!items || items.length === 0) {
            return;
        }

        var bar = document.createElement('div');
        bar.className = 'editor-toolbar';

        var self = this;

        var el;
        self.toolbar = {};

        for (var i = 0; i < items.length; i++) {
            (function(item) {
                var el;
                if (item.name) {
                    el = createIcon(item.name, item);
                } else if (item === '|') {
                    el = createSep();
                } else {
                    el = createIcon(item);
                }

                // bind events, special for info
                if (item.action) {
                    if (typeof item.action === 'function') {
                        el.onclick = function(e) {
                            item.action(self);
                        };
                    } else if (typeof item.action === 'string') {
                        el.href = item.action;
                        el.target = '_blank';
                    }
                }
                self.toolbar[item.name || item] = el;
                bar.appendChild(el);
            })(items[i]);
        }

        var cm = this.codemirror;
        cm.on('cursorActivity', function() {
            var stat = getState(cm);

            for (var key in self.toolbar) {
                (function(key) {
                    var el = self.toolbar[key];
                    if (stat[key]) {
                        el.className += ' active';
                    } else {
                        el.className = el.className.replace(/\s*active\s*/g, '');
                    }
                })(key);
            }
        });

        var cmWrapper = cm.getWrapperElement();
        cmWrapper.parentNode.insertBefore(bar, cmWrapper);
        return bar;
    };

    Editor.prototype.createStatusbar = function(status) {
        status = status || this.options.status;

        if (!status || status.length === 0) return;

        var bar = document.createElement('div');
        bar.className = 'editor-statusbar';

        var pos, cm = this.codemirror;
        for (var i = 0; i < status.length; i++) {
            (function(name) {
                var el = document.createElement('span');
                el.className = name;
                if (name === 'words') {
                    el.innerHTML = '0';
                    cm.on('update', function() {
                        el.innerHTML = wordCount(cm.getValue());
                    });
                } else if (name === 'lines') {
                    el.innerHTML = '0';
                    cm.on('update', function() {
                        el.innerHTML = cm.lineCount();
                    });
                } else if (name === 'cursor') {
                    el.innerHTML = '0:0';
                    cm.on('cursorActivity', function() {
                        pos = cm.getCursor();
                        el.innerHTML = pos.line + ':' + pos.ch;
                    });
                }
                bar.appendChild(el);
            })(status[i]);
        }
        var cmWrapper = this.codemirror.getWrapperElement();
        cmWrapper.parentNode.insertBefore(bar, cmWrapper.nextSibling);
        return bar;
    };


    /**
     * Bind static methods for exports.
     */
    Editor.toggleBold = toggleBold;
    Editor.toggleItalic = toggleItalic;
    Editor.toggleBlockquote = toggleBlockquote;
    Editor.toggleUnOrderedList = toggleUnOrderedList;
    Editor.toggleOrderedList = toggleOrderedList;
    Editor.drawLink = drawLink;
    Editor.drawImage = drawImage;
    Editor.undo = undo;
    Editor.redo = redo;
    Editor.toggleFullScreen = toggleFullScreen;

    /**
     * Bind instance methods for exports.
     */
    Editor.prototype.toggleBold = function() {
        toggleBold(this);
    };
    Editor.prototype.toggleItalic = function() {
        toggleItalic(this);
    };
    Editor.prototype.toggleBlockquote = function() {
        toggleBlockquote(this);
    };
    Editor.prototype.toggleUnOrderedList = function() {
        toggleUnOrderedList(this);
    };
    Editor.prototype.toggleOrderedList = function() {
        toggleOrderedList(this);
    };
    Editor.prototype.drawLink = function() {
        drawLink(this);
    };
    Editor.prototype.drawImage = function() {
        drawImage(this);
    };
    Editor.prototype.undo = function() {
        undo(this);
    };
    Editor.prototype.redo = function() {
        redo(this);
    };
    Editor.prototype.toggleFullScreen = function() {
        toggleFullScreen(this);
    };

    global.Editor = Editor;
})(this);
/*! inline-attach - v1.2.4 - 2013-06-24 */
/*jslint newcap: true */
/*global XMLHttpRequest: false, inlineAttach: false, FormData: false */
/*
 * Inline Text Attachment
 *
 * Copyright 2012 Roy van Kaathoven.
 * Contact: royvankaathoven@hotmail.com
 *
 * Licensed under the MIT License.
 */
(function(document, window) {
    "use strict";

    /**
     * Simple function to merge the given objects
     *
     * @param {Object[]} object Multiple object parameters
     * @returns {Object}
     */
    function merge() {
        var result = {};
        for (var i = arguments.length - 1; i >= 0; i--) {
            var obj = arguments[i];
            for (var k in obj) {
                result[k] = obj[k];
            }
        }
        return result;
    }

    /**
     * @param {Object} options
     */
    window.inlineAttach = function(options, instance) {

        var settings = merge(options, inlineAttach.defaults),
            editor = instance,
            filenameTag = '{filename}',
            lastValue,
            me = this;

        /**
         * Upload a given file blob
         *
         * @param {Blob} file
         */
        this.uploadFile = function(file) {
            var formData = new FormData(),
                xhr = new XMLHttpRequest();

            // Attach the file. If coming from clipboard, add a default filename (only works in Chrome for now)
            // http://stackoverflow.com/questions/6664967/how-to-give-a-blob-uploaded-as-formdata-a-file-name
            formData.append(settings.uploadFieldName, file, "image-" + Date.now() + ".png");

            xhr.open('POST', settings.uploadUrl);
            xhr.onload = function() {
                // If HTTP status is OK or Created
                if (xhr.status === 200 || xhr.status === 201) {
                    var data = JSON.parse(xhr.responseText);
                    me.onUploadedFile(data);
                } else {
                    me.onErrorUploading();
                }
            };
            xhr.send(formData);
        };

        /**
         * Check if the given file is allowed
         *
         * @param {File} file
         */
        this.isAllowedFile = function(file) {
            return settings.allowedTypes.indexOf(file.type) >= 0;
        };

        /**
         * When a file has finished uploading
         *
         * @param {Object} data
         */
        this.onUploadedFile = function(data) {
            var result = settings.onUploadedFile(data),
                filename = data[settings.downloadFieldName];
            if (result !== false && filename) {
                var text = editor.getValue().replace(lastValue, settings.urlText.replace(filenameTag, filename));
                editor.setValue(text);
            }
        };

        /**
         * Custom upload handler
         *
         * @param {Blob} file
         * @return {Boolean} when false is returned it will prevent default upload behavior
         */
        this.customUploadHandler = function(file) {
            return settings.customUploadHandler(file);
        };

        /**
         * When a file didn't upload properly.
         * Override by passing your own onErrorUploading function with settings.
         *
         * @param {Object} data
         */
        this.onErrorUploading = function() {
            var text = editor.getValue().replace(lastValue, "");
            editor.setValue(text);
            if (settings.customErrorHandler()) {
                window.alert(settings.errorText);
            }
        };

        /**
         * Append a line of text at the bottom, ensuring there aren't unnecessary newlines
         *
         * @param {String} appended Current content
         * @param {String} previous Value which should be appended after the current content
         */
        function appendInItsOwnLine(previous, appended) {
            return (previous + "\n\n[[D]]" + appended)
                  .replace(/(\n{2,})\[\[D\]\]/, "\n\n")
                  .replace(/^(\n*)/, "");
        }

        /**
         * When a file has been received by a drop or paste event
         * @param {Blob} file
         */
        this.onReceivedFile = function(file) {
            var result = settings.onReceivedFile(file);
            if (result !== false) {
                lastValue = settings.progressText;
                editor.setValue(appendInItsOwnLine(editor.getValue(), lastValue));
            }
        };

        /**
         * Catches the paste event
         *
         * @param {Event} e
         * @returns {Boolean} If a file is handled
         */
        this.onPaste = function(e) {
            var result = false,
                clipboardData = e.clipboardData;

            if (typeof clipboardData === "object" && clipboardData.items !== null) {
                for (var i = 0; i < clipboardData.items.length; i++) {
                    var item = clipboardData.items[i];
                    if (me.isAllowedFile(item)) {
                        result = true;
                        this.onReceivedFile(item.getAsFile());
                        if(this.customUploadHandler(item.getAsFile())){
                            this.uploadFile(item.getAsFile());
                        }
                    }
                }
            }


            return result;
        };

        /**
         * Catches onDrop event
         *
         * @param {Event} e
         * @returns {Boolean} If a file is handled
         */
        this.onDrop = function(e) {
            var result = false;
            for (var i = 0; i < e.dataTransfer.files.length; i++) {
                var file = e.dataTransfer.files[i];
                if (me.isAllowedFile(file)) {
                    result = true;
                    this.onReceivedFile(file);
                    if(this.customUploadHandler(file)){
                        this.uploadFile(file);
                    }
                }
            }

            return result;
        };
    };

    /**
     * Editor
     */
    window.inlineAttach.Editor = function(instance) {

        var input = instance;

        return {
            getValue: function() {
                return input.value;
            },
            setValue: function(val) {
                input.value = val;
            }
        };
    };

    /**
     * Default configuration
     */
    window.inlineAttach.defaults = {
        // URL to upload the attachment
        uploadUrl: 'upload_attachment.php',
        // Request field name where the attachment will be placed in the form data
        uploadFieldName: 'file',
        // Where is the filename placed in the response
        downloadFieldName: 'filename',
        allowedTypes: [
            'image/jpeg',
            'image/png',
            'image/jpg',
            'image/gif'
        ],

        /**
         * Will be inserted on a drop or paste event
         */
        progressText: '![Uploading file...]()',

        /**
         * When a file has successfully been uploaded the last inserted text
         * will be replaced by the urlText, the {filename} tag will be replaced
         * by the filename that has been returned by the server
         */
        urlText: "![file]({filename})",

        /**
         * When a file is received by drag-drop or paste
         */
        onReceivedFile: function() {},

        /**
         * Custom upload handler
         *
         * @return {Boolean} when false is returned it will prevent default upload behavior
         */
        customUploadHandler: function() { return true; },

        /**
         * Custom error handler. Runs after removing the placeholder text and before the alert().
         * Return false from this function to prevent the alert dialog.
         *
         * @return {Boolean} when false is returned it will prevent default error behavior
         */
        customErrorHandler: function() { return true; },

        /**
         * Text for default error when uploading
         */
        errorText: "Error uploading file",

        /**
         * When a file has succesfully been uploaded
         */
        onUploadedFile: function() {}
    };

    /**
     * Attach to a standard input field
     *
     * @param {Input} input
     * @param {Object} options
     */
    window.inlineAttach.attachToInput = function(input, options) {

        options = options || {};

        var editor          = new inlineAttach.Editor(input),
            inlineattach    = new inlineAttach(options, editor);

        input.addEventListener('paste', function(e) {
            inlineattach.onPaste(e);
        }, false);
        input.addEventListener('drop', function(e) {
            e.stopPropagation();
            e.preventDefault();
            inlineattach.onDrop(e);
        }, false);
        input.addEventListener('dragenter', function(e) {
            e.stopPropagation();
            e.preventDefault();
        }, false);
        input.addEventListener('dragover', function(e) {
            e.stopPropagation();
            e.preventDefault();
        }, false);
    };

})(document, window);

/*jslint newcap: true */
/*global inlineAttach: false */
/**
 * CodeMirror version for inlineAttach
 *
 * Call inlineAttach.attachToCodeMirror(editor) to attach to a codemirror instance
 *
 * @param {document} document
 * @param {window} window
 */
(function(document, window) {
    "use strict";

    function CodeMirrorEditor(instance) {

        if (!instance.getWrapperElement) {
            throw "Invalid CodeMirror object given";
        }

        var codeMirror = instance;

        return {
            getValue: function() {
                return codeMirror.getValue();
            },
            setValue: function(val) {
                var cursor = codeMirror.getCursor();
                codeMirror.setValue(val);
                codeMirror.setCursor(cursor);
            }
        };
    }

    CodeMirrorEditor.prototype = new inlineAttach.Editor();

    /**
     * @param {CodeMirror} codeMirror
     */
    window.inlineAttach.attachToCodeMirror = function(codeMirror, options) {

        options = options || {};

        var editor          = new CodeMirrorEditor(codeMirror),
            inlineattach    = new inlineAttach(options, editor),
            el              = codeMirror.getWrapperElement();

        el.addEventListener('paste', function(e) {
            inlineattach.onPaste(e);
        }, false);

        codeMirror.setOption('onDragEvent', function(data, e) {
            if (e.type === "drop") {
                e.stopPropagation();
                e.preventDefault();
                return inlineattach.onDrop(e);
            }
        });
    };

})(document, window);
/*
	Redactor v9.2.5
	Updated: Jun 5, 2014

	http://imperavi.com/redactor/

	Copyright (c) 2009-2014, Imperavi LLC.
	License: http://imperavi.com/redactor/license/

	Usage: $('#content').redactor();
*/
(function($)
{
	var uuid = 0;

	"use strict";

	var Range = function(range)
	{
		this[0] = range.startOffset;
		this[1] = range.endOffset;

		this.range = range;

		return this;
	};

	Range.prototype.equals = function()
	{
		return this[0] === this[1];
	};

	var reUrlYoutube = /https?:\/\/(?:[0-9A-Z-]+\.)?(?:youtu\.be\/|youtube\.com\S*[^\w\-\s])([\w\-]{11})(?=[^\w\-]|$)(?![?=&+%\w.-]*(?:['"][^<>]*>|<\/a>))[?=&+%\w.-]*/ig;
	var reUrlVimeo = /https?:\/\/(www\.)?vimeo.com\/(\d+)($|\/)/;

	// Plugin
	$.fn.redactor = function(options)
	{
		var val = [];
		var args = Array.prototype.slice.call(arguments, 1);

		if (typeof options === 'string')
		{
			this.each(function()
			{
				var instance = $.data(this, 'redactor');
				if (typeof instance !== 'undefined' && $.isFunction(instance[options]))
				{
					var methodVal = instance[options].apply(instance, args);
					if (methodVal !== undefined && methodVal !== instance) val.push(methodVal);
				}
				else return $.error('No such method "' + options + '" for Redactor');
			});
		}
		else
		{
			this.each(function()
			{
				if (!$.data(this, 'redactor')) $.data(this, 'redactor', Redactor(this, options));
			});
		}

		if (val.length === 0) return this;
		else if (val.length === 1) return val[0];
		else return val;

	};

	// Initialization
	function Redactor(el, options)
	{
		return new Redactor.prototype.init(el, options);
	}

	$.Redactor = Redactor;
	$.Redactor.VERSION = '9.2.5';
	$.Redactor.opts = {

			// settings
			rangy: false,

			iframe: false,
			fullpage: false,
			css: false, // url

			lang: 'en',
			direction: 'ltr', // ltr or rtl

			placeholder: false,

			typewriter: false,
			wym: false,
			mobile: true,
			cleanup: true,
			tidyHtml: true,
			pastePlainText: false,
			removeEmptyTags: true,
			cleanSpaces: true,
			cleanFontTag: true,
			templateVars: false,
			xhtml: false,

			visual: true,
			focus: false,
			tabindex: false,
			autoresize: true,
			minHeight: false,
			maxHeight: false,
			shortcuts: {
				'ctrl+m, meta+m': "this.execCommand('removeFormat', false)",
				'ctrl+b, meta+b': "this.execCommand('bold', false)",
				'ctrl+i, meta+i': "this.execCommand('italic', false)",
				'ctrl+h, meta+h': "this.execCommand('superscript', false)",
				'ctrl+l, meta+l': "this.execCommand('subscript', false)",
				'ctrl+k, meta+k': "this.linkShow()",
				'ctrl+shift+7': "this.execCommand('insertorderedlist', false)",
				'ctrl+shift+8': "this.execCommand('insertunorderedlist', false)"
			},
			shortcutsAdd: false,

			autosave: false, // false or url
			autosaveInterval: 60, // seconds

			plugins: false, // array

			//linkAnchor: true,
			//linkEmail: true,
			linkProtocol: 'http://',
			linkNofollow: false,
			linkSize: 50,
			predefinedLinks: false, // json url (ex. /some-url.json ) or false

			imageFloatMargin: '10px',
			imageGetJson: false, // json url (ex. /some-images.json ) or false

			dragUpload: true, // false
			imageTabLink: true,
			imageUpload: false, // url
			imageUploadParam: 'file', // input name
			imageResizable: true,

			fileUpload: false, // url
			fileUploadParam: 'file', // input name
			clipboardUpload: true, // or false
			clipboardUploadUrl: false, // url

			dnbImageTypes: ['image/png', 'image/jpeg', 'image/gif'], // or false

			s3: false,
			uploadFields: false,

			observeImages: true,
			observeLinks: true,

			modalOverlay: true,

			tabSpaces: false, // true or number of spaces
			tabFocus: true,

			air: false,
			airButtons: ['formatting', 'bold', 'italic', 'deleted', 'unorderedlist', 'orderedlist', 'outdent', 'indent'],

			toolbar: true,
			toolbarFixed: false,
			toolbarFixedTarget: document,
			toolbarFixedTopOffset: 0, // pixels
			toolbarFixedBox: false,
			toolbarExternal: false, // ID selector
			toolbarOverflow: false,
			buttonSource: true,

			buttons: ['html', 'formatting', 'bold', 'italic', 'deleted', 'unorderedlist', 'orderedlist',
					  'outdent', 'indent', 'image', 'video', 'file', 'table', 'link', 'alignment', '|',
					  'horizontalrule'], // 'underline', 'alignleft', 'aligncenter', 'alignright', 'justify'
			buttonsHideOnMobile: [],

			activeButtons: ['deleted', 'italic', 'bold', 'underline', 'unorderedlist', 'orderedlist',
							'alignleft', 'aligncenter', 'alignright', 'justify', 'table'],
			activeButtonsStates: {
				b: 'bold',
				strong: 'bold',
				i: 'italic',
				em: 'italic',
				del: 'deleted',
				strike: 'deleted',
				ul: 'unorderedlist',
				ol: 'orderedlist',
				u: 'underline',
				tr: 'table',
				td: 'table',
				table: 'table'
			},

			formattingTags: ['p', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],

			linebreaks: false,
			paragraphy: true,
			convertDivs: true,
			convertLinks: true,
			convertImageLinks: false,
			convertVideoLinks: false,
			formattingPre: false,
			phpTags: false,

			allowedTags: false,
			deniedTags: ['html', 'head', 'link', 'body', 'meta', 'script', 'style', 'applet'],

			boldTag: 'strong',
			italicTag: 'em',

			// private
			indentValue: 20,
			buffer: [],
			rebuffer: [],
			textareamode: false,
			emptyHtml: '<p>&#x200b;</p>',
			invisibleSpace: '&#x200b;',
			rBlockTest: /^(P|H[1-6]|LI|ADDRESS|SECTION|HEADER|FOOTER|ASIDE|ARTICLE)$/i,
			alignmentTags: ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DD', 'DL', 'DT', 'DIV', 'TD',
								'BLOCKQUOTE', 'OUTPUT', 'FIGCAPTION', 'ADDRESS', 'SECTION',
								'HEADER', 'FOOTER', 'ASIDE', 'ARTICLE'],
			ownLine: ['area', 'body', 'head', 'hr', 'i?frame', 'link', 'meta', 'noscript', 'style', 'script', 'table', 'tbody', 'thead', 'tfoot'],
			contOwnLine: ['li', 'dt', 'dt', 'h[1-6]', 'option', 'script'],
			newLevel: ['blockquote', 'div', 'dl', 'fieldset', 'form', 'frameset', 'map', 'ol', 'p', 'pre', 'select', 'td', 'th', 'tr', 'ul'],
			blockLevelElements: ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DD', 'DL', 'DT', 'DIV', 'LI',
								'BLOCKQUOTE', 'OUTPUT', 'FIGCAPTION', 'PRE', 'ADDRESS', 'SECTION',
								'HEADER', 'FOOTER', 'ASIDE', 'ARTICLE', 'TD'],


			// lang
			langs: {
				en: {
					html: 'HTML',
					video: 'Insert Video',
					image: 'Insert Image',
					table: 'Table',
					link: 'Link',
					link_insert: 'Insert link',
					link_edit: 'Edit link',
					unlink: 'Unlink',
					formatting: 'Formatting',
					paragraph: 'Normal text',
					quote: 'Quote',
					code: 'Code',
					header1: 'Header 1',
					header2: 'Header 2',
					header3: 'Header 3',
					header4: 'Header 4',
					header5: 'Header 5',
					bold: 'Bold',
					italic: 'Italic',
					fontcolor: 'Font Color',
					backcolor: 'Back Color',
					unorderedlist: 'Unordered List',
					orderedlist: 'Ordered List',
					outdent: 'Outdent',
					indent: 'Indent',
					cancel: 'Cancel',
					insert: 'Insert',
					save: 'Save',
					_delete: 'Delete',
					insert_table: 'Insert Table',
					insert_row_above: 'Add Row Above',
					insert_row_below: 'Add Row Below',
					insert_column_left: 'Add Column Left',
					insert_column_right: 'Add Column Right',
					delete_column: 'Delete Column',
					delete_row: 'Delete Row',
					delete_table: 'Delete Table',
					rows: 'Rows',
					columns: 'Columns',
					add_head: 'Add Head',
					delete_head: 'Delete Head',
					title: 'Title',
					image_position: 'Position',
					none: 'None',
					left: 'Left',
					right: 'Right',
					center: 'Center',
					image_web_link: 'Image Web Link',
					text: 'Text',
					mailto: 'Email',
					web: 'URL',
					video_html_code: 'Video Embed Code',
					file: 'Insert File',
					upload: 'Upload',
					download: 'Download',
					choose: 'Choose',
					or_choose: 'Or choose',
					drop_file_here: 'Drop file here',
					align_left: 'Align text to the left',
					align_center: 'Center text',
					align_right: 'Align text to the right',
					align_justify: 'Justify text',
					horizontalrule: 'Insert Horizontal Rule',
					deleted: 'Deleted',
					anchor: 'Anchor',
					link_new_tab: 'Open link in new tab',
					underline: 'Underline',
					alignment: 'Alignment',
					filename: 'Name (optional)',
					edit: 'Edit'
				}
			}
	};

	// Functionality
	Redactor.fn = $.Redactor.prototype = {

		keyCode: {
			BACKSPACE: 8,
			DELETE: 46,
			DOWN: 40,
			ENTER: 13,
			ESC: 27,
			TAB: 9,
			CTRL: 17,
			META: 91,
			LEFT: 37,
			LEFT_WIN: 91
		},

		// Initialization
		init: function(el, options)
		{
			this.rtePaste = false;
			this.$element = this.$source = $(el);
			this.uuid = uuid++;

			// clonning options
			var opts = $.extend(true, {}, $.Redactor.opts);

			// current settings
			this.opts = $.extend(
				{},
				opts,
				this.$element.data(),
				options
			);

			this.start = true;
			this.dropdowns = [];

			// get sizes
			this.sourceHeight = this.$source.css('height');
			this.sourceWidth = this.$source.css('width');

			// dependency of the editor modes
			if (this.opts.fullpage) this.opts.iframe = true;
			if (this.opts.linebreaks) this.opts.paragraphy = false;
			if (this.opts.paragraphy) this.opts.linebreaks = false;
			if (this.opts.toolbarFixedBox) this.opts.toolbarFixed = true;

			// the alias for iframe mode
			this.document = document;
			this.window = window;

			// selection saved
			this.savedSel = false;

			// clean setup
			this.cleanlineBefore = new RegExp('^<(/?' + this.opts.ownLine.join('|/?' ) + '|' + this.opts.contOwnLine.join('|') + ')[ >]');
			this.cleanlineAfter = new RegExp('^<(br|/?' + this.opts.ownLine.join('|/?' ) + '|/' + this.opts.contOwnLine.join('|/') + ')[ >]');
			this.cleannewLevel = new RegExp('^</?(' + this.opts.newLevel.join('|' ) + ')[ >]');

			// block level
			this.rTestBlock = new RegExp('^(' + this.opts.blockLevelElements.join('|' ) + ')$', 'i');

			// setup formatting permissions
			if (this.opts.linebreaks === false)
			{
				if (this.opts.allowedTags !== false)
				{
					var arrSearch = ['strong', 'em', 'del'];
					var arrAdd = ['b', 'i', 'strike'];

					if ($.inArray('p', this.opts.allowedTags) === '-1') this.opts.allowedTags.push('p');

					for (i in arrSearch)
					{
						if ($.inArray(arrSearch[i], this.opts.allowedTags) != '-1') this.opts.allowedTags.push(arrAdd[i]);
					}
				}

				if (this.opts.deniedTags !== false)
				{
					var pos = $.inArray('p', this.opts.deniedTags);
					if (pos !== '-1') this.opts.deniedTags.splice(pos, pos);
				}
			}

			// ie & opera
			if (this.browser('msie') || this.browser('opera'))
			{
				this.opts.buttons = this.removeFromArrayByValue(this.opts.buttons, 'horizontalrule');
			}

			// load lang
			this.opts.curLang = this.opts.langs[this.opts.lang];

			// extend shortcuts
			$.extend(this.opts.shortcuts, this.opts.shortcutsAdd);

			// init placeholder
			this.placeholderInit();

			// Build
			this.buildStart();

		},
		toolbarInit: function(lang)
		{
			return {
				html:
				{
					title: lang.html,
					func: 'toggle'
				},
				formatting:
				{
					title: lang.formatting,
					func: 'show',
					dropdown:
					{
						p:
						{
							title: lang.paragraph,
							func: 'formatBlocks'
						},
						blockquote:
						{
							title: lang.quote,
							func: 'formatQuote',
							className: 'redactor_format_blockquote'
						},
						pre:
						{
							title: lang.code,
							func: 'formatBlocks',
							className: 'redactor_format_pre'
						},
						h1:
						{
							title: lang.header1,
							func: 'formatBlocks',
							className: 'redactor_format_h1'
						},
						h2:
						{
							title: lang.header2,
							func: 'formatBlocks',
							className: 'redactor_format_h2'
						},
						h3:
						{
							title: lang.header3,
							func: 'formatBlocks',
							className: 'redactor_format_h3'
						},
						h4:
						{
							title: lang.header4,
							func: 'formatBlocks',
							className: 'redactor_format_h4'
						},
						h5:
						{
							title: lang.header5,
							func: 'formatBlocks',
							className: 'redactor_format_h5'
						}
					}
				},
				bold:
				{
					title: lang.bold,
					exec: 'bold'
				},
				italic:
				{
					title: lang.italic,
					exec: 'italic'
				},
				deleted:
				{
					title: lang.deleted,
					exec: 'strikethrough'
				},
				underline:
				{
					title: lang.underline,
					exec: 'underline'
				},
				unorderedlist:
				{
					title: '&bull; ' + lang.unorderedlist,
					exec: 'insertunorderedlist'
				},
				orderedlist:
				{
					title: '1. ' + lang.orderedlist,
					exec: 'insertorderedlist'
				},
				outdent:
				{
					title: '< ' + lang.outdent,
					func: 'indentingOutdent'
				},
				indent:
				{
					title: '> ' + lang.indent,
					func: 'indentingIndent'
				},
				image:
				{
					title: lang.image,
					func: 'imageShow'
				},
				video:
				{
					title: lang.video,
					func: 'videoShow'
				},
				file:
				{
					title: lang.file,
					func: 'fileShow'
				},
				table:
				{
					title: lang.table,
					func: 'show',
					dropdown:
					{
						insert_table:
						{
							title: lang.insert_table,
							func: 'tableShow'
						},
						separator_drop1:
						{
							name: 'separator'
						},
						insert_row_above:
						{
							title: lang.insert_row_above,
							func: 'tableAddRowAbove'
						},
						insert_row_below:
						{
							title: lang.insert_row_below,
							func: 'tableAddRowBelow'
						},
						insert_column_left:
						{
							title: lang.insert_column_left,
							func: 'tableAddColumnLeft'
						},
						insert_column_right:
						{
							title: lang.insert_column_right,
							func: 'tableAddColumnRight'
						},
						separator_drop2:
						{
							name: 'separator'
						},
						add_head:
						{
							title: lang.add_head,
							func: 'tableAddHead'
						},
						delete_head:
						{
							title: lang.delete_head,
							func: 'tableDeleteHead'
						},
						separator_drop3:
						{
							name: 'separator'
						},
						delete_column:
						{
							title: lang.delete_column,
							func: 'tableDeleteColumn'
						},
						delete_row:
						{
							title: lang.delete_row,
							func: 'tableDeleteRow'
						},
						delete_table:
						{
							title: lang.delete_table,
							func: 'tableDeleteTable'
						}
					}
				},
				link: {
					title: lang.link,
					func: 'show',
					dropdown:
					{
						link:
						{
							title: lang.link_insert,
							func: 'linkShow'
						},
						unlink:
						{
							title: lang.unlink,
							exec: 'unlink'
						}
					}
				},
				alignment:
				{
					title: lang.alignment,
					func: 'show',
					dropdown:
					{
						alignleft:
						{
							title: lang.align_left,
							func: 'alignmentLeft'
						},
						aligncenter:
						{
							title: lang.align_center,
							func: 'alignmentCenter'
						},
						alignright:
						{
							title: lang.align_right,
							func: 'alignmentRight'
						},
						justify:
						{
							title: lang.align_justify,
							func: 'alignmentJustify'
						}
					}
				},
				alignleft:
				{
					title: lang.align_left,
					func: 'alignmentLeft'
				},
				aligncenter:
				{
					title: lang.align_center,
					func: 'alignmentCenter'
				},
				alignright:
				{
					title: lang.align_right,
					func: 'alignmentRight'
				},
				alignjustify:
				{
					title: lang.align_justify,
					func: 'alignmentJustify'
				},
				horizontalrule:
				{
					exec: 'inserthorizontalrule',
					title: lang.horizontalrule
				}

			}
		},

		// CALLBACKS
		callback: function(type, event, data)
		{
			var callback = this.opts[ type + 'Callback' ];
			if ($.isFunction(callback))
			{
				if (event === false) return callback.call(this, data);
				else return callback.call(this, event, data);
			}
			else return data;
		},


		// DESTROY
		destroy: function()
		{
			clearInterval(this.autosaveInterval);

			$(window).off('.redactor');
			this.$source.off('redactor-textarea');
			this.$element.off('.redactor').removeData('redactor');

			var html = this.get();

			if (this.opts.textareamode)
			{
				this.$box.after(this.$source);
				this.$box.remove();
				this.$source.val(html).show();
			}
			else
			{
				var $elem = this.$editor;
				if (this.opts.iframe) $elem = this.$element;

				this.$box.after($elem);
				this.$box.remove();

				$elem.removeClass('redactor_editor').removeClass('redactor_editor_wym').removeAttr('contenteditable').html(html).show();
			}

			if (this.opts.toolbarExternal)
			{
				$(this.opts.toolbarExternal).html('');
			}

			if (this.opts.air)
			{
				$('#redactor_air_' + this.uuid).remove();
			}
		},

		// API GET
		getObject: function()
		{
			return $.extend({}, this);
		},
		getEditor: function()
		{
			return this.$editor;
		},
		getBox: function()
		{
			return this.$box;
		},
		getIframe: function()
		{
			return (this.opts.iframe) ? this.$frame : false;
		},
		getToolbar: function()
		{
			return (this.$toolbar) ? this.$toolbar : false;
		},

		// CODE GET & SET
		get: function()
		{
			return this.$source.val();
		},
		getCodeIframe: function()
		{
			this.$editor.removeAttr('contenteditable').removeAttr('dir');
			var html = this.outerHtml(this.$frame.contents().children());
			this.$editor.attr({ 'contenteditable': true, 'dir': this.opts.direction });

			return html;
		},
		set: function(html, strip, placeholderRemove)
		{
			html = html.toString();
			html = html.replace(/\$/g, '&#36;');

			if (this.opts.fullpage) this.setCodeIframe(html);
			else this.setEditor(html, strip);

			if (html == '') placeholderRemove = false;
			if (placeholderRemove !== false) this.placeholderRemoveFromEditor();
		},
		setEditor: function(html, strip)
		{

			if (strip !== false)
			{
				html = this.cleanSavePreCode(html);

				html = this.cleanStripTags(html);
				html = this.cleanConvertProtected(html);
				html = this.cleanConvertInlineTags(html, true);

				if (this.opts.linebreaks === false)	html = this.cleanConverters(html);
				else html = html.replace(/<p(.*?)>([\w\W]*?)<\/p>/gi, '$2<br>');
			}

			// $ fix
			html = html.replace(/&amp;#36;/g, '$');

			html = this.cleanEmpty(html);

			this.$editor.html(html);

			// set no editable
			this.setNonEditable();
			this.setSpansVerified();

			this.sync();
		},
		setCodeIframe: function(html)
		{
			var doc = this.iframePage();
			this.$frame[0].src = "about:blank";

			html = this.cleanConvertProtected(html);
			html = this.cleanConvertInlineTags(html);
			html = this.cleanRemoveSpaces(html);

			doc.open();
			doc.write(html);
			doc.close();

			// redefine editor for fullpage mode
			if (this.opts.fullpage)
			{
				this.$editor = this.$frame.contents().find('body').attr({ 'contenteditable': true, 'dir': this.opts.direction });
			}

			// set no editable
			this.setNonEditable();
			this.setSpansVerified();
			this.sync();

		},
		setFullpageOnInit: function(html)
		{
			this.fullpageDoctype = html.match(/^<\!doctype[^>]*>/i);
			if (this.fullpageDoctype && this.fullpageDoctype.length == 1)
			{
				html = html.replace(/^<\!doctype[^>]*>/i, '');
			}

			html = this.cleanSavePreCode(html, true);
			html = this.cleanConverters(html);
			html = this.cleanEmpty(html);

			// set code
			this.$editor.html(html);

			// set no editable
			this.setNonEditable();
			this.setSpansVerified();
			this.sync();
		},
		setFullpageDoctype: function()
		{
			if (this.fullpageDoctype && this.fullpageDoctype.length == 1)
			{
				var source = this.fullpageDoctype[0] + '\n' + this.$source.val();
				this.$source.val(source);
			}
		},
		setSpansVerified: function()
		{
			var spans = this.$editor.find('span');
			var replacementTag = 'inline';

			$.each(spans, function() {
				var outer = this.outerHTML;

				// Replace opening tag
				var regex = new RegExp('<' + this.tagName, 'gi');
				var newTag = outer.replace(regex, '<' + replacementTag);

				// Replace closing tag
				regex = new RegExp('</' + this.tagName, 'gi');
				newTag = newTag.replace(regex, '</' + replacementTag);

				$(this).replaceWith(newTag);
			});

		},
		setSpansVerifiedHtml: function(html)
		{
			html = html.replace(/<span(.*?)>/, '<inline$1>');
			return html.replace(/<\/span>/, '</inline>');
		},
		setNonEditable: function()
		{
			this.$editor.find('.noneditable').attr('contenteditable', false);
		},

		// SYNC
		sync: function(e)
		{
			var html = '';

			this.cleanUnverified();

			if (this.opts.fullpage) html = this.getCodeIframe();
			else html = this.$editor.html();

			html = this.syncClean(html);
			html = this.cleanRemoveEmptyTags(html);

			// is there a need to synchronize
			var source = this.cleanRemoveSpaces(this.$source.val(), false);
			var editor = this.cleanRemoveSpaces(html, false);

			if (source == editor)
			{
				// do not sync
				return false;
			}


			// fix second level up ul, ol
			html = html.replace(/<\/li><(ul|ol)>([\w\W]*?)<\/(ul|ol)>/gi, '<$1>$2</$1></li>');

			if ($.trim(html) === '<br>') html = '';

			// xhtml
			if (this.opts.xhtml)
			{
				var xhtmlTags = ['br', 'hr', 'img', 'link', 'input', 'meta'];
				$.each(xhtmlTags, function(i,s)
				{
					html = html.replace(new RegExp('<' + s + '(.*?[^\/$]?)>', 'gi'), '<' + s + '$1 />');
				});

			}

			// before callback
			html = this.callback('syncBefore', false, html);

			this.$source.val(html);
			this.setFullpageDoctype();

			// onchange & after callback
			this.callback('syncAfter', false, html);

			if (this.start === false)
			{

				if (typeof e != 'undefined')
				{
					switch(e.which)
					{
				        case 37: // left
				        break;
				        case 38: // up
				        break;
				        case 39: // right
				        break;
				        case 40: // down
				        break;

						default: this.callback('change', false, html);
					}
				}
				else
				{
					this.callback('change', false, html);
				}
			}

		},
		syncClean: function(html)
		{
			if (!this.opts.fullpage) html = this.cleanStripTags(html);

			// trim
			html = $.trim(html);

			// removeplaceholder
			html = this.placeholderRemoveFromCode(html);

			// remove space
			html = html.replace(/&#x200b;/gi, '');
			html = html.replace(/&#8203;/gi, '');
			html = html.replace(/<\/a>&nbsp;/gi, '<\/a> ');
			html = html.replace(/\u200B/g, '');

			if (html == '<p></p>' || html == '<p> </p>' || html == '<p>&nbsp;</p>')
			{
				html = '';
			}

			// link nofollow
			if (this.opts.linkNofollow)
			{
				html = html.replace(/<a(.*?)rel="nofollow"(.*?)>/gi, '<a$1$2>');
				html = html.replace(/<a(.*?)>/gi, '<a$1 rel="nofollow">');
			}

			// php code fix
			html = html.replace('<!--?php', '<?php');
			html = html.replace('?-->', '?>');

			// revert no editable
			html = html.replace(/<(.*?)class="noeditable"(.*?) contenteditable="false"(.*?)>/gi, '<$1class="noeditable"$2$3>');

			html = html.replace(/ data-tagblock=""/gi, '');
			html = html.replace(/<br\s?\/?>\n?<\/(P|H[1-6]|LI|ADDRESS|SECTION|HEADER|FOOTER|ASIDE|ARTICLE)>/gi, '</$1>');

			// remove image resize
			html = html.replace(/<span(.*?)id="redactor-image-box"(.*?)>([\w\W]*?)<img(.*?)><\/span>/gi, '$3<img$4>');
			html = html.replace(/<span(.*?)id="redactor-image-resizer"(.*?)>(.*?)<\/span>/gi, '');
			html = html.replace(/<span(.*?)id="redactor-image-editter"(.*?)>(.*?)<\/span>/gi, '');

			// remove empty lists
			html = html.replace(/<(ul|ol)>\s*\t*\n*<\/(ul|ol)>/gi, '');

			// remove font
			if (this.opts.cleanFontTag)
			{
				html = html.replace(/<font(.*?)>([\w\W]*?)<\/font>/gi, '$2');
			}

			// remove spans
			html = html.replace(/<span(.*?)>([\w\W]*?)<\/span>/gi, '$2');
			html = html.replace(/<inline>([\w\W]*?)<\/inline>/gi, '$1');
			html = html.replace(/<inline>/gi, '<span>');
			html = html.replace(/<inline /gi, '<span ');
			html = html.replace(/<\/inline>/gi, '</span>');

			if (this.opts.removeEmptyTags)
			{
				html = html.replace(/<span>([\w\W]*?)<\/span>/gi, '$1');
			}

			html = html.replace(/<span(.*?)class="redactor_placeholder"(.*?)>([\w\W]*?)<\/span>/gi, '');
			html = html.replace(/<img(.*?)contenteditable="false"(.*?)>/gi, '<img$1$2>');

			// special characters
			html = html.replace(/&/gi, '&');
			html = html.replace(/\u2122/gi, '&trade;');
			html = html.replace(/\u00a9/gi, '&copy;');
			html = html.replace(/\u2026/gi, '&hellip;');
			html = html.replace(/\u2014/gi, '&mdash;');
			html = html.replace(/\u2010/gi, '&dash;');

			html = this.cleanReConvertProtected(html);

			return html;
		},



		// BUILD
		buildStart: function()
		{
			// content
			this.content = '';

			// container
			this.$box = $('<div class="redactor_box" />');

			// textarea test
			if (this.$source[0].tagName === 'TEXTAREA') this.opts.textareamode = true;

			// mobile
			if (this.opts.mobile === false && this.isMobile())
			{
				this.buildMobile();
			}
			else
			{
				// get the content at the start
				this.buildContent();

				if (this.opts.iframe)
				{
					// build as iframe
					this.opts.autoresize = false;
					this.iframeStart();
				}
				else if (this.opts.textareamode) this.buildFromTextarea();
				else this.buildFromElement();

				// options and final setup
				if (!this.opts.iframe)
				{
					this.buildOptions();
					this.buildAfter();
				}
			}
		},
		buildMobile: function()
		{
			if (!this.opts.textareamode)
			{
				this.$editor = this.$source;
				this.$editor.hide();
				this.$source = this.buildCodearea(this.$editor);
				this.$source.val(this.content);
			}

			this.$box.insertAfter(this.$source).append(this.$source);
		},
		buildContent: function()
		{
			if (this.opts.textareamode) this.content = $.trim(this.$source.val());
			else this.content = $.trim(this.$source.html());
		},
		buildFromTextarea: function()
		{
			this.$editor = $('<div />');
			this.$box.insertAfter(this.$source).append(this.$editor).append(this.$source);

			// enable
			this.buildAddClasses(this.$editor);
			this.buildEnable();
		},
		buildFromElement: function()
		{
			this.$editor = this.$source;
			this.$source = this.buildCodearea(this.$editor);
			this.$box.insertAfter(this.$editor).append(this.$editor).append(this.$source);

			// enable
			this.buildEnable();
		},
		buildCodearea: function($source)
		{
			return $('<textarea />').attr('name', $source.attr('id')).css('height', this.sourceHeight);
		},
		buildAddClasses: function(el)
		{
			// append textarea classes to editable layer
			$.each(this.$source.get(0).className.split(/\s+/), function(i,s)
			{
				el.addClass('redactor_' + s);
			});
		},
		buildEnable: function()
		{
			this.$editor.addClass('redactor_editor').attr({ 'contenteditable': true, 'dir': this.opts.direction });
			this.$source.attr('dir', this.opts.direction).hide();

			// set code
			this.set(this.content, true, false);
		},
		buildOptions: function()
		{
			var $source = this.$editor;
			if (this.opts.iframe) $source = this.$frame;

			// options
			if (this.opts.tabindex) $source.attr('tabindex', this.opts.tabindex);

			if (this.opts.minHeight) $source.css('min-height', this.opts.minHeight + 'px');
			// FF fix bug with line-height rendering
			else if (this.browser('mozilla') && this.opts.linebreaks)
			{
				this.$editor.css('min-height', '45px');
			}
			// FF fix bug with line-height rendering
			if (this.browser('mozilla') && this.opts.linebreaks)
			{
				this.$editor.css('padding-bottom', '10px');
			}


			if (this.opts.maxHeight)
			{
				this.opts.autoresize = false;
				this.sourceHeight = this.opts.maxHeight;
			}
			if (this.opts.wym) this.$editor.addClass('redactor_editor_wym');
			if (this.opts.typewriter) this.$editor.addClass('redactor-editor-typewriter');
			if (!this.opts.autoresize) $source.css('height', this.sourceHeight);

		},
		buildAfter: function()
		{
			this.start = false;

			// load toolbar
			if (this.opts.toolbar)
			{
				this.opts.toolbar = this.toolbarInit(this.opts.curLang);
				this.toolbarBuild();
			}

			// modal templates
			this.modalTemplatesInit();

			// plugins
			this.buildPlugins();

			// enter, tab, etc.
			this.buildBindKeyboard();

			// autosave
			if (this.opts.autosave) this.autosave();

			// observers
			setTimeout($.proxy(this.observeStart, this), 4);

			// FF fix
			if (this.browser('mozilla'))
			{
				try {
					this.document.execCommand('enableObjectResizing', false, false);
					this.document.execCommand('enableInlineTableEditing', false, false);
				} catch (e) {}
			}

			// focus
			if (this.opts.focus) setTimeout($.proxy(this.focus, this), 100);

			// code mode
			if (!this.opts.visual)
			{
				setTimeout($.proxy(function()
				{
					this.opts.visual = true;
					this.toggle(false);

				}, this), 200);
			}

			// init callback
			this.callback('init');
		},
		buildBindKeyboard: function()
		{
			this.dblEnter = 0;

			if (this.opts.dragUpload && (this.opts.imageUpload !== false || this.opts.s3 !== false))
			{
				this.$editor.on('drop.redactor', $.proxy(this.buildEventDrop, this));
			}

			this.$editor.on('click.redactor', $.proxy(function()
			{
				this.selectall = false;

			}, this));

			this.$editor.on('input.redactor', $.proxy(this.sync, this));
			this.$editor.on('paste.redactor', $.proxy(this.buildEventPaste, this));
			this.$editor.on('keydown.redactor', $.proxy(this.buildEventKeydown, this));
			this.$editor.on('keyup.redactor', $.proxy(this.buildEventKeyup, this));

			// textarea callback
			if ($.isFunction(this.opts.textareaKeydownCallback))
			{
				this.$source.on('keydown.redactor-textarea', $.proxy(this.opts.textareaKeydownCallback, this));
			}

			// focus callback
			if ($.isFunction(this.opts.focusCallback))
			{
				this.$editor.on('focus.redactor', $.proxy(this.opts.focusCallback, this));
			}

			var clickedElement;
			$(document).mousedown(function(e) {
				clickedElement = $(e.target);
			});

			// blur callback
			this.$editor.on('blur.redactor', $.proxy(function(e)
			{
				if (!$(clickedElement).hasClass('redactor_toolbar') && $(clickedElement).parents('.redactor_toolbar').size() == 0)
				{
					this.selectall = false;
					if ($.isFunction(this.opts.blurCallback)) this.callback('blur', e);
				}
			}, this));

		},
		buildEventDrop: function(e)
		{
			e = e.originalEvent || e;

			if (window.FormData === undefined || !e.dataTransfer) return true;

		    var length = e.dataTransfer.files.length;
		    if (length == 0) return true;

		    e.preventDefault();

	        var file = e.dataTransfer.files[0];

	        if (this.opts.dnbImageTypes !== false && this.opts.dnbImageTypes.indexOf(file.type) == -1)
	        {
		        return true;
	        }

			this.bufferSet();

			this.showProgressBar();

			if (this.opts.s3 === false)
			{
				this.dragUploadAjax(this.opts.imageUpload, file, true, e, this.opts.imageUploadParam);
			}
			else
			{
				this.s3uploadFile(file);
			}


		},
		buildEventPaste: function(e)
		{
			var oldsafari = false;
			if (this.browser('webkit') && navigator.userAgent.indexOf('Chrome') === -1)
			{
				var arr = this.browser('version').split('.');
				if (arr[0] < 536) oldsafari = true;
			}

			if (oldsafari) return true;

			// paste except opera (not webkit)
			if (this.browser('opera')) return true;

			// clipboard upload
			if (this.opts.clipboardUpload && this.buildEventClipboardUpload(e)) return true;

			if (this.opts.cleanup)
			{
				this.rtePaste = true;

				this.selectionSave();

				if (!this.selectall)
				{
					if (this.opts.autoresize === true && this.fullscreen !== true)
					{
						this.$editor.height(this.$editor.height());
						this.saveScroll = this.document.body.scrollTop;
					}
					else
					{
						this.saveScroll = this.$editor.scrollTop();
					}
				}

				var frag = this.extractContent();

				setTimeout($.proxy(function()
				{
					var pastedFrag = this.extractContent();
					this.$editor.append(frag);

					this.selectionRestore();

					var html = this.getFragmentHtml(pastedFrag);
					this.pasteClean(html);

					if (this.opts.autoresize === true && this.fullscreen !== true) this.$editor.css('height', 'auto');

				}, this), 1);
			}
		},
		buildEventClipboardUpload: function(e)
		{
			var event = e.originalEvent || e;
			this.clipboardFilePaste = false;


			if (typeof(event.clipboardData) === 'undefined') return false;
			if (event.clipboardData.items)
			{
				var file = event.clipboardData.items[0].getAsFile();
				if (file !== null)
				{
					this.bufferSet();
					this.clipboardFilePaste = true;

					var reader = new FileReader();
					reader.onload = $.proxy(this.pasteClipboardUpload, this);
			        reader.readAsDataURL(file);

			        return true;
				}
			}

			return false;

		},
		buildEventKeydown: function(e)
		{
			if (this.rtePaste) return false;

			var key = e.which;
			var ctrl = e.ctrlKey || e.metaKey;
			var parent = this.getParent();
			var current = this.getCurrent();
			var block = this.getBlock();
			var pre = false;

			this.callback('keydown', e);

			/*
				firefox cmd+left/Cmd+right browser back/forward fix -
				http://joshrhoderick.wordpress.com/2010/05/05/how-firefoxs-command-key-bug-kills-usability-on-the-mac/
			*/
			if (this.browser('mozilla') && "modify" in window.getSelection())
			{
				if ((ctrl) && (e.keyCode===37 || e.keyCode===39))
				{
					var selection = this.getSelection();
					var lineOrWord = (e.metaKey ? "line" : "word");
					if (e.keyCode===37)
					{
						selection.modify("extend","left",lineOrWord);
						if (!e.shiftKey)
						{
							selection.collapseToStart();
						}
					}
					if (e.keyCode===39)
					{
						selection.modify("extend","right",lineOrWord);
						if (!e.shiftKey)
						{
							selection.collapseToEnd();
						}
					}

					e.preventDefault();
				}
			}


			this.imageResizeHide(false);

			// pre & down
			if ((parent && $(parent).get(0).tagName === 'PRE') || (current && $(current).get(0).tagName === 'PRE'))
			{
				pre = true;
				if (key === this.keyCode.DOWN) this.insertAfterLastElement(block);
			}

			// down
			if (key === this.keyCode.DOWN)
			{
				if (parent && $(parent)[0].tagName === 'BLOCKQUOTE') this.insertAfterLastElement(parent);
				if (current && $(current)[0].tagName === 'BLOCKQUOTE') this.insertAfterLastElement(current);

				if (parent && $(parent)[0].tagName === 'P' && $(parent).parent()[0].tagName == 'BLOCKQUOTE')
				{
					this.insertAfterLastElement(parent, $(parent).parent()[0]);
				}
				if (current && $(current)[0].tagName === 'P' && parent && $(parent)[0].tagName == 'BLOCKQUOTE')
				{
					this.insertAfterLastElement(current, parent);
				}
			}

			// shortcuts setup
			this.shortcuts(e, key);

			// buffer setup
			if (ctrl && key === 90 && !e.shiftKey && !e.altKey) // z key
			{
				e.preventDefault();
				if (this.opts.buffer.length) this.bufferUndo();
				else this.document.execCommand('undo', false, false);
				return;
			}
			// undo
			else if (ctrl && key === 90 && e.shiftKey && !e.altKey)
			{
				e.preventDefault();
				if (this.opts.rebuffer.length != 0) this.bufferRedo();
				else this.document.execCommand('redo', false, false);
				return;
			}

			// space
			if (key == 32)
			{
				this.bufferSet();
			}

			// select all
			if (ctrl && key === 65)
			{
				this.bufferSet();
				this.selectall = true;
			}
			else if (key != this.keyCode.LEFT_WIN && !ctrl)
			{
				this.selectall = false;
			}

			// enter
			if (key == this.keyCode.ENTER && !e.shiftKey && !e.ctrlKey && !e.metaKey)
			{
				// remove selected content on enter
				var range = this.getRange();
				if (range && range.collapsed === false)
				{
					sel = this.getSelection();
					if (sel.rangeCount)
					{
						range.deleteContents();
					}
				}

				// In ie, opera in the tables are created paragraphs, fix it.
				if (this.browser('msie') && (parent.nodeType == 1 && (parent.tagName == 'TD' || parent.tagName == 'TH')))
				{
					e.preventDefault();
					this.bufferSet();
					this.insertNode(document.createElement('br'));
					this.callback('enter', e);
					return false;
				}

				// blockquote exit
				if (block && (block.tagName == 'BLOCKQUOTE' || $(block).parent()[0].tagName == 'BLOCKQUOTE'))
				{
					if (this.isEndOfElement())
					{
						if (this.dblEnter == 1)
						{
							var element;
							var last;
							if (block.tagName == 'BLOCKQUOTE')
							{
								last = 'br';
								element = block;
							}
							else
							{
								last = 'p';
								element = $(block).parent()[0];
							}

							e.preventDefault();
							this.insertingAfterLastElement(element);
							this.dblEnter = 0;

							if (last == 'p')
							{
								$(block).parent().find('p').last().remove();
							}
							else
							{
								var tmp = $.trim($(block).html());
								$(block).html(tmp.replace(/<br\s?\/?>$/i, ''));
							}

							return;
						}
						else this.dblEnter++;
					}
					else this.dblEnter++;
				}

				// pre
				if (pre === true)
				{
					return this.buildEventKeydownPre(e, current);
				}
				else
				{
					if (!this.opts.linebreaks)
					{
						// lists exit
						if (block && block.tagName == 'LI')
						{
							var listCurrent = this.getBlock();
							if (listCurrent !== false || listCurrent.tagName === 'LI')
							{
								var listText = $.trim($(block).text());
								var listCurrentText = $.trim($(listCurrent).text());
								if (listText == ''
									&& listCurrentText == ''
									&& $(listCurrent).next('li').size() == 0
									&& $(listCurrent).parents('li').size() == 0)
								{
									this.bufferSet();

									var $list = $(listCurrent).closest('ol, ul');
									$(listCurrent).remove();
									var node = $('<p>' + this.opts.invisibleSpace + '</p>');
									$list.after(node);
									this.selectionStart(node);

									this.sync();
									this.callback('enter', e);
									return false;
								}
							}

						}

						// replace div to p
						if (block && this.opts.rBlockTest.test(block.tagName))
						{
							// hit enter
							this.bufferSet();

							setTimeout($.proxy(function()
							{
								var blockElem = this.getBlock();
								if (blockElem.tagName === 'DIV' && !$(blockElem).hasClass('redactor_editor'))
								{
									var node = $('<p>' + this.opts.invisibleSpace + '</p>');
									$(blockElem).replaceWith(node);
									this.selectionStart(node);
								}

							}, this), 1);
						}
						else if (block === false)
						{
							// hit enter
							this.bufferSet();
							var node = $('<p>' + this.opts.invisibleSpace + '</p>');
							this.insertNode(node[0]);
							this.selectionStart(node);
							this.callback('enter', e);
							return false;
						}

					}

					if (this.opts.linebreaks)
					{
						// replace div to br
						if (block && this.opts.rBlockTest.test(block.tagName))
						{
							// hit enter
							this.bufferSet();

							setTimeout($.proxy(function()
							{
								var blockElem = this.getBlock();
								if ((blockElem.tagName === 'DIV' || blockElem.tagName === 'P') && !$(blockElem).hasClass('redactor_editor'))
								{
									this.replaceLineBreak(blockElem);
								}

							}, this), 1);
						}
						else
						{
							return this.buildEventKeydownInsertLineBreak(e);
						}
					}

					// blockquote, figcaption
					if (block.tagName == 'BLOCKQUOTE' || block.tagName == 'FIGCAPTION')
					{
						return this.buildEventKeydownInsertLineBreak(e);
					}

				}

				this.callback('enter', e);
			}
			else if (key === this.keyCode.ENTER && (e.ctrlKey || e.shiftKey)) // Shift+Enter or Ctrl+Enter
			{
				this.bufferSet();

				e.preventDefault();
				this.insertLineBreak();
			}

			// tab (cmd + [)
			if ((key === this.keyCode.TAB || e.metaKey && key === 219) && this.opts.shortcuts)
			{
				return this.buildEventKeydownTab(e, pre, key);
			}

			// delete zero-width space before the removing
			if (key === this.keyCode.BACKSPACE) this.buildEventKeydownBackspace(e, current, parent);

		},
		buildEventKeydownPre: function(e, current)
		{
			e.preventDefault();
			this.bufferSet();
			var html = $(current).parent().text();
			this.insertNode(document.createTextNode('\n'));
			if (html.search(/\s$/) == -1)
			{
				this.insertNode(document.createTextNode('\n'));
			}

			this.sync();
			this.callback('enter', e);
			return false;
		},
		buildEventKeydownTab: function(e, pre, key)
		{
			if (!this.opts.tabFocus) return true;
			if (this.isEmpty(this.get()) && this.opts.tabSpaces === false) return true;

			e.preventDefault();

			if (pre === true && !e.shiftKey)
			{
				this.bufferSet();
				this.insertNode(document.createTextNode('\t'));
				this.sync();
				return false;

			}
			else if (this.opts.tabSpaces !== false)
			{
				this.bufferSet();
				this.insertNode(document.createTextNode(Array(this.opts.tabSpaces + 1).join('\u00a0')));
				this.sync();
				return false;
			}
			else
			{
				if (!e.shiftKey) this.indentingIndent();
				else this.indentingOutdent();
			}

			return false;
		},
		buildEventKeydownBackspace: function(e, current, parent)
		{
			// remove empty list in table
			if (parent && current && parent.parentNode.tagName == 'TD'
				&& parent.tagName == 'UL' && current.tagName == 'LI' && $(parent).children('li').size() == 1)
			{
				var text = $(current).text().replace(/[\u200B-\u200D\uFEFF]/g, '');
				if (text == '')
				{
					var node = parent.parentNode;
					$(parent).remove();
					this.selectionStart(node);
					this.sync();
					return false;
				}
			}

			if (typeof current.tagName !== 'undefined' && /^(H[1-6])$/i.test(current.tagName))
			{
				var node;
				if (this.opts.linebreaks === false) node = $('<p>' + this.opts.invisibleSpace + '</p>');
				else node = $('<br>' + this.opts.invisibleSpace);

				$(current).replaceWith(node);
				this.selectionStart(node);
				this.sync();
			}

			if (typeof current.nodeValue !== 'undefined' && current.nodeValue !== null)
			{
				if (current.remove && current.nodeType === 3 && current.nodeValue.match(/[^\u200B]/g) == null)
				{
					$(current).prev().remove();
					this.sync();
				}
			}
		},
		buildEventKeydownInsertLineBreak: function(e)
		{
			this.bufferSet();
			e.preventDefault();
			this.insertLineBreak();
			this.callback('enter', e);
			return;
		},
		buildEventKeyup: function(e)
		{
			if (this.rtePaste) return false;

			var key = e.which;
			var parent = this.getParent();
			var current = this.getCurrent();

			// replace to p before / after the table or body
			if (!this.opts.linebreaks && current.nodeType == 3 && (parent == false || parent.tagName == 'BODY'))
			{
				var node = $('<p>').append($(current).clone());
				$(current).replaceWith(node);
				var next = $(node).next();
				if (typeof(next[0]) !== 'undefined' && next[0].tagName == 'BR')
				{
					next.remove();
				}

				this.selectionEnd(node);
			}

			// convert links
			if ((this.opts.convertLinks || this.opts.convertImageLinks || this.opts.convertVideoLinks) && key === this.keyCode.ENTER)
			{
				this.buildEventKeyupConverters();
			}

			// if empty
			if (key === this.keyCode.DELETE || key === this.keyCode.BACKSPACE)
			{
				return this.formatEmpty(e);
			}

			this.callback('keyup', e);
			this.sync(e);
		},
		buildEventKeyupConverters: function()
		{
			this.formatLinkify(this.opts.linkProtocol, this.opts.convertLinks, this.opts.convertImageLinks, this.opts.convertVideoLinks, this.opts.linkSize);

			setTimeout($.proxy(function()
			{
				if (this.opts.convertImageLinks) this.observeImages();
				if (this.opts.observeLinks) this.observeLinks();
			}, this), 5);
		},
		buildPlugins: function()
		{
			if (!this.opts.plugins ) return;

			$.each(this.opts.plugins, $.proxy(function(i, s)
			{
				if (RedactorPlugins[s])
				{
					$.extend(this, RedactorPlugins[s]);
					if ($.isFunction( RedactorPlugins[ s ].init)) this.init();
				}

			}, this ));
		},

		// IFRAME
		iframeStart: function()
		{
			this.iframeCreate();

			if (this.opts.textareamode) this.iframeAppend(this.$source);
			else
			{
				this.$sourceOld = this.$source.hide();
				this.$source = this.buildCodearea(this.$sourceOld);
				this.iframeAppend(this.$sourceOld);
			}
		},
		iframeAppend: function(el)
		{
			this.$source.attr('dir', this.opts.direction).hide();
			this.$box.insertAfter(el).append(this.$frame).append(this.$source);
		},
		iframeCreate: function()
		{
			this.$frame = $('<iframe style="width: 100%;" frameborder="0" />').one('load', $.proxy(function()
			{
				if (this.opts.fullpage)
				{
					this.iframePage();

					if (this.content === '') this.content = this.opts.invisibleSpace;

					this.$frame.contents()[0].write(this.content);
					this.$frame.contents()[0].close();

					var timer = setInterval($.proxy(function()
					{
						if (this.$frame.contents().find('body').html())
						{
							clearInterval(timer);
							this.iframeLoad();
						}

					}, this), 0);
				}
				else this.iframeLoad();

			}, this));
		},
		iframeDoc: function()
		{
			return this.$frame[0].contentWindow.document;
		},
		iframePage: function()
		{
			var doc = this.iframeDoc();
			if (doc.documentElement) doc.removeChild(doc.documentElement);

			return doc;
		},
		iframeAddCss: function(css)
		{
			css = css || this.opts.css;

			if (this.isString(css))
			{
				this.$frame.contents().find('head').append('<link rel="stylesheet" href="' + css + '" />');
			}

			if ($.isArray(css))
			{
				$.each(css, $.proxy(function(i, url)
				{
					this.iframeAddCss(url);

				}, this));
			}
		},
		iframeLoad: function()
		{
			this.$editor = this.$frame.contents().find('body').attr({ 'contenteditable': true, 'dir': this.opts.direction });

			// set document & window
			if (this.$editor[0])
			{
				this.document = this.$editor[0].ownerDocument;
				this.window = this.document.defaultView || window;
			}

			// iframe css
			this.iframeAddCss();

			if (this.opts.fullpage)
			{
				this.setFullpageOnInit(this.$source.val());
			}
			else this.set(this.content, true, false);

			this.buildOptions();
			this.buildAfter();
		},

		// PLACEHOLDER
		placeholderInit: function()
		{
			if (this.opts.placeholder !== false)
			{
				this.placeholderText = this.opts.placeholder;
				this.opts.placeholder = true;
			}
			else
			{
				if (typeof this.$element.attr('placeholder') == 'undefined' || this.$element.attr('placeholder') == '')
				{
					this.opts.placeholder = false;
				}
				else
				{
					this.placeholderText = this.$element.attr('placeholder');
					this.opts.placeholder = true;
				}
			}
		},
		placeholderStart: function(html)
		{
			if (this.opts.placeholder === false)
			{
				return false;
			}

			if (this.isEmpty(html))
			{
				this.opts.focus = false;
				this.placeholderOnFocus();
				this.placeholderOnBlur();

				return this.placeholderGet();
			}
			else
			{
				this.placeholderOnBlur();
			}

			return false;
		},
		placeholderOnFocus: function()
		{
			this.$editor.on('focus.redactor_placeholder', $.proxy(this.placeholderFocus, this));
		},
		placeholderOnBlur: function()
		{
			this.$editor.on('blur.redactor_placeholder', $.proxy(this.placeholderBlur, this));
		},
		placeholderGet: function()
		{
			var ph = $('<span class="redactor_placeholder">').data('redactor', 'verified')
			.attr('contenteditable', false).text(this.placeholderText);

			if (this.opts.linebreaks === false)
			{
				return $('<p>').append(ph);
			}
			else return ph;
		},
		placeholderBlur: function()
		{
			var html = this.get();
			if (this.isEmpty(html))
			{
				this.placeholderOnFocus();
				this.$editor.html(this.placeholderGet());
			}
		},
		placeholderFocus: function()
		{
			this.$editor.find('span.redactor_placeholder').remove();

			var html = '';
			if (this.opts.linebreaks === false)
			{
				html = this.opts.emptyHtml;
			}

			this.$editor.off('focus.redactor_placeholder');
			this.$editor.html(html);

			if (this.opts.linebreaks === false)
			{
				// place the cursor inside emptyHtml
				this.selectionStart(this.$editor.children()[0]);
			}
			else
			{
				this.focus();
			}

			this.sync();
		},
		placeholderRemoveFromEditor: function()
		{
			this.$editor.find('span.redactor_placeholder').remove();
			this.$editor.off('focus.redactor_placeholder');
		},
		placeholderRemoveFromCode: function(html)
		{
			return html.replace(/<span class="redactor_placeholder"(.*?)>(.*?)<\/span>/i, '');
		},

		// SHORTCUTS
		shortcuts: function(e, key)
		{

			// disable browser's hot keys for bold and italic
			if (!this.opts.shortcuts)
			{
				if ((e.ctrlKey || e.metaKey) && (key === 66 || key === 73))
				{
					e.preventDefault();
				}

				return false;
			}

			$.each(this.opts.shortcuts, $.proxy(function(str, command)
			{
				var keys = str.split(',');
				for (var i in keys)
				{
					if (typeof keys[i] === 'string')
					{
						this.shortcutsHandler(e, $.trim(keys[i]), $.proxy(function()
						{
							eval(command);
						}, this));
					}

				}

			}, this));


		},
		shortcutsHandler: function(e, keys, origHandler)
		{
			// based on https://github.com/jeresig/jquery.hotkeys
			var hotkeysSpecialKeys =
			{
				8: "backspace", 9: "tab", 10: "return", 13: "return", 16: "shift", 17: "ctrl", 18: "alt", 19: "pause",
				20: "capslock", 27: "esc", 32: "space", 33: "pageup", 34: "pagedown", 35: "end", 36: "home",
				37: "left", 38: "up", 39: "right", 40: "down", 45: "insert", 46: "del", 59: ";", 61: "=",
				96: "0", 97: "1", 98: "2", 99: "3", 100: "4", 101: "5", 102: "6", 103: "7",
				104: "8", 105: "9", 106: "*", 107: "+", 109: "-", 110: ".", 111 : "/",
				112: "f1", 113: "f2", 114: "f3", 115: "f4", 116: "f5", 117: "f6", 118: "f7", 119: "f8",
				120: "f9", 121: "f10", 122: "f11", 123: "f12", 144: "numlock", 145: "scroll", 173: "-", 186: ";", 187: "=",
				188: ",", 189: "-", 190: ".", 191: "/", 192: "`", 219: "[", 220: "\\", 221: "]", 222: "'"
			};


			var hotkeysShiftNums =
			{
				"`": "~", "1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^", "7": "&",
				"8": "*", "9": "(", "0": ")", "-": "_", "=": "+", ";": ": ", "'": "\"", ",": "<",
				".": ">",  "/": "?",  "\\": "|"
			};

			keys = keys.toLowerCase().split(" ");
			var special = hotkeysSpecialKeys[e.keyCode],
				character = String.fromCharCode( e.which ).toLowerCase(),
				modif = "", possible = {};

			$.each([ "alt", "ctrl", "meta", "shift"], function(index, specialKey)
			{
				if (e[specialKey + 'Key'] && special !== specialKey)
				{
					modif += specialKey + '+';
				}
			});


			if (special)
			{
				possible[modif + special] = true;
			}

			if (character)
			{
				possible[modif + character] = true;
				possible[modif + hotkeysShiftNums[character]] = true;

				// "$" can be triggered as "Shift+4" or "Shift+$" or just "$"
				if (modif === "shift+")
				{
					possible[hotkeysShiftNums[character]] = true;
				}
			}

			for (var i = 0, l = keys.length; i < l; i++)
			{
				if (possible[keys[i]])
				{
					e.preventDefault();
					return origHandler.apply(this, arguments);
				}
			}
		},

		// FOCUS
		focus: function()
		{
			if (!this.browser('opera'))
			{
				this.window.setTimeout($.proxy(this.focusSet, this, true), 1);
			}
			else
			{
				this.$editor.focus();
			}
		},
		focusWithSaveScroll: function()
		{
			if (this.browser('msie'))
			{
				var top = this.document.documentElement.scrollTop;
			}

			this.$editor.focus();

			if (this.browser('msie'))
			{
				this.document.documentElement.scrollTop = top;
			}
		},
		focusEnd: function()
		{
			if (!this.browser('mozilla'))
			{
				this.focusSet();
			}
			else
			{
				if (this.opts.linebreaks === false)
				{
					var last = this.$editor.children().last();

					this.$editor.focus();
					this.selectionEnd(last);
				}
				else
				{
					this.focusSet();
				}
			}
       	},
		focusSet: function(collapse, element)
		{
			this.$editor.focus();

			if (typeof element == 'undefined')
			{
				element = this.$editor[0];
			}

			var range = this.getRange();
			range.selectNodeContents(element);

			// collapse - controls the position of focus: the beginning (true), at the end (false).
			range.collapse(collapse || false);

			var sel = this.getSelection();
			sel.removeAllRanges();
			sel.addRange(range);
		},

		// TOGGLE
		toggle: function(direct)
		{
			if (this.opts.visual) this.toggleCode(direct);
			else this.toggleVisual();
		},
		toggleVisual: function()
		{
			var html = this.$source.hide().val();
			if (typeof this.modified !== 'undefined')
			{
				var modified = this.modified.replace(/\n/g, '');

				var thtml = html.replace(/\n/g, '');
				thtml = this.cleanRemoveSpaces(thtml, false);

				this.modified = this.cleanRemoveSpaces(modified, false) !== thtml;
			}

			if (this.modified)
			{
				// don't remove the iframe even if cleared all.
				if (this.opts.fullpage && html === '')
				{
					this.setFullpageOnInit(html);
				}
				else
				{
					this.set(html);
					if (this.opts.fullpage)
					{
						this.buildBindKeyboard();
					}
				}

				this.callback('change', false, html);
			}

			if (this.opts.iframe) this.$frame.show();
			else this.$editor.show();

			if (this.opts.fullpage) this.$editor.attr('contenteditable', true );

			this.$source.off('keydown.redactor-textarea-indenting');

			this.$editor.focus();
			this.selectionRestore();

			this.observeStart();
			this.buttonActiveVisual();
			this.buttonInactive('html');
			this.opts.visual = true;


		},
		toggleCode: function(direct)
		{
			if (direct !== false) this.selectionSave();

			var height = null;
			if (this.opts.iframe)
			{
				height = this.$frame.height();
				if (this.opts.fullpage) this.$editor.removeAttr('contenteditable');
				this.$frame.hide();
			}
			else
			{
				height = this.$editor.innerHeight();
				this.$editor.hide();
			}

			var html = this.$source.val();

			// tidy html
			if (html !== '' && this.opts.tidyHtml)
			{
				this.$source.val(this.cleanHtml(html));
			}

			this.modified = html;

			this.$source.height(height).show().focus();

			// textarea indenting
			this.$source.on('keydown.redactor-textarea-indenting', this.textareaIndenting);

			this.buttonInactiveVisual();
			this.buttonActive('html');
			this.opts.visual = false;
		},
		textareaIndenting: function(e)
		{
			if (e.keyCode === 9)
			{
				var $el = $(this);
				var start = $el.get(0).selectionStart;
				$el.val($el.val().substring(0, start) + "\t" + $el.val().substring($el.get(0).selectionEnd));
				$el.get(0).selectionStart = $el.get(0).selectionEnd = start + 1;
				return false;
			}
		},

		// AUTOSAVE
		autosave: function()
		{
			var savedHtml = false;
			this.autosaveInterval = setInterval($.proxy(function()
			{
				var html = this.get();
				if (savedHtml !== html)
				{
					var name = this.$source.attr('name');
					$.ajax({
						url: this.opts.autosave,
						type: 'post',
						data: 'name=' + name + '&' + name + '=' + escape(encodeURIComponent(html)),
						success: $.proxy(function(data)
						{
							var json = $.parseJSON(data);
							if (typeof json.error == 'undefined')
							{
								// success
								this.callback('autosave', false, json);
							}
							else
							{
								// error
								this.callback('autosaveError', false, json);
							}

							savedHtml = html;

						}, this)
					});
				}
			}, this), this.opts.autosaveInterval*1000);
		},

		// TOOLBAR
		toolbarBuild: function()
		{
			// hide on mobile
			if (this.isMobile() && this.opts.buttonsHideOnMobile.length > 0)
			{
				$.each(this.opts.buttonsHideOnMobile, $.proxy(function(i, s)
				{
					var index = this.opts.buttons.indexOf(s);
					this.opts.buttons.splice(index, 1);

				}, this));
			}

			// extend buttons
			if (this.opts.air)
			{
				this.opts.buttons = this.opts.airButtons;
			}
			else
			{
				if (!this.opts.buttonSource)
				{
					var index = this.opts.buttons.indexOf('html');
					this.opts.buttons.splice(index, 1);
				}
			}

			// formatting tags
			if (this.opts.toolbar)
			{
				$.each(this.opts.toolbar.formatting.dropdown, $.proxy(function (i, s)
				{
					if ($.inArray(i, this.opts.formattingTags ) == '-1') delete this.opts.toolbar.formatting.dropdown[i];

				}, this));
			}

			// if no buttons don't create a toolbar
			if (this.opts.buttons.length === 0) return false;

			// air enable
			this.airEnable();

			// toolbar build
			this.$toolbar = $('<ul>').addClass('redactor_toolbar').attr('id', 'redactor_toolbar_' + this.uuid);

			if (this.opts.typewriter)
			{
				this.$toolbar.addClass('redactor-toolbar-typewriter');
			}

			if (this.opts.toolbarOverflow && this.isMobile())
			{
				this.$toolbar.addClass('redactor-toolbar-overflow');
			}

			if (this.opts.air)
			{
				// air box
				this.$air = $('<div class="redactor_air">').attr('id', 'redactor_air_' + this.uuid).hide();
				this.$air.append(this.$toolbar);
				$('body').append(this.$air);
			}
			else
			{
				if (this.opts.toolbarExternal)
				{
					this.$toolbar.addClass('redactor-toolbar-external');
					$(this.opts.toolbarExternal).html(this.$toolbar);
				}
				else this.$box.prepend(this.$toolbar);
			}

			$.each(this.opts.buttons, $.proxy(function(i, btnName)
			{
				if (this.opts.toolbar[btnName])
				{
					var btnObject = this.opts.toolbar[btnName];
					if (this.opts.fileUpload === false && btnName === 'file') return true;
					this.$toolbar.append( $('<li>').append(this.buttonBuild(btnName, btnObject)));
				}

			}, this));

			this.$toolbar.find('a').attr('tabindex', '-1');

			// fixed
			if (this.opts.toolbarFixed)
			{
				this.toolbarObserveScroll();
				$(this.opts.toolbarFixedTarget).on('scroll.redactor', $.proxy(this.toolbarObserveScroll, this));
			}

			// buttons response
			if (this.opts.activeButtons)
			{
				this.$editor.on('mouseup.redactor keyup.redactor', $.proxy(this.buttonActiveObserver, this));
			}
		},
		toolbarObserveScroll: function()
		{
			var scrollTop = $(this.opts.toolbarFixedTarget).scrollTop();

			var boxTop = 0;
			var left = 0;
			var end = 0;

			if (this.opts.toolbarFixedTarget === document)
			{
				boxTop = this.$box.offset().top;
			}
			else
			{
				boxTop = 1;
			}

			end = boxTop + this.$box.height() + 40;

			if (scrollTop > boxTop)
			{
				var width = '100%';
				if (this.opts.toolbarFixedBox)
				{
					left = this.$box.offset().left;
					width = this.$box.innerWidth();
					this.$toolbar.addClass('toolbar_fixed_box');
				}

				this.toolbarFixed = true;

				if (this.opts.toolbarFixedTarget === document)
				{
					this.$toolbar.css({
						position: 'fixed',
						width: width,
						zIndex: 10005,
						top: this.opts.toolbarFixedTopOffset + 'px',
						left: left
					});
				}
				else
				{
					this.$toolbar.css({
						position: 'absolute',
						width: width,
						zIndex: 10005,
						top: (this.opts.toolbarFixedTopOffset + scrollTop) + 'px',
						left: 0
					});
				}

				if (scrollTop < end) this.$toolbar.css('visibility', 'visible');
				else this.$toolbar.css('visibility', 'hidden');
			}
			else
			{
				this.toolbarFixed = false;
				this.$toolbar.css({
					position: 'relative',
					width: 'auto',
					top: 0,
					left: left
				});

				if (this.opts.toolbarFixedBox) this.$toolbar.removeClass('toolbar_fixed_box');
			}
		},

		// AIR
		airEnable: function()
		{
			if (!this.opts.air) return;

			this.$editor.on('mouseup.redactor keyup.redactor', this, $.proxy(function(e)
			{
				var text = this.getSelectionText();

				if (e.type === 'mouseup' && text != '') this.airShow(e);
				if (e.type === 'keyup' && e.shiftKey && text != '')
				{
					var $focusElem = $(this.getElement(this.getSelection().focusNode)), offset = $focusElem.offset();
					offset.height = $focusElem.height();
					this.airShow(offset, true);
				}

			}, this));
		},
		airShow: function (e, keyboard)
		{
			if (!this.opts.air) return;

			var left, top;
			$('.redactor_air').hide();

			if (keyboard)
			{
				left = e.left;
				top = e.top + e.height + 14;

				if (this.opts.iframe)
				{
					top += this.$box.position().top - $(this.document).scrollTop();
					left += this.$box.position().left;
				}
			}
			else
			{
				var width = this.$air.innerWidth();

				left = e.clientX;
				if ($(this.document).width() < (left + width)) left -= width;

				top = e.clientY + 14;
				if (this.opts.iframe)
				{
					top += this.$box.position().top;
					left += this.$box.position().left;
				}
				else top += $( this.document ).scrollTop();
			}

			this.$air.css({
				left: left + 'px',
				top: top + 'px'
			}).show();

			this.airBindHide();
		},
		airBindHide: function()
		{
			if (!this.opts.air) return;

			var hideHandler = $.proxy(function(doc)
			{
				$(doc).on('mousedown.redactor', $.proxy(function(e)
				{
					if ($( e.target ).closest(this.$toolbar).length === 0)
					{
						this.$air.fadeOut(100);
						this.selectionRemove();
						$(doc).off(e);
					}

				}, this)).on('keydown.redactor', $.proxy(function(e)
				{
					if (e.which === this.keyCode.ESC)
					{
						this.getSelection().collapseToStart();
					}

					this.$air.fadeOut(100);
					$(doc).off(e);

				}, this));
			}, this);

			// Hide the toolbar at events in all documents (iframe)
			hideHandler(document);
			if (this.opts.iframe) hideHandler(this.document);
		},
		airBindMousemoveHide: function()
		{
			if (!this.opts.air) return;

			var hideHandler = $.proxy(function(doc)
			{
				$(doc).on('mousemove.redactor', $.proxy(function(e)
				{
					if ($( e.target ).closest(this.$toolbar).length === 0)
					{
						this.$air.fadeOut(100);
						$(doc).off(e);
					}

				}, this));
			}, this);

			// Hide the toolbar at events in all documents (iframe)
			hideHandler(document);
			if (this.opts.iframe) hideHandler(this.document);
		},

		// DROPDOWNS
		dropdownBuild: function($dropdown, dropdownObject)
		{
			$.each(dropdownObject, $.proxy(function(btnName, btnObject)
			{
				if (!btnObject.className) btnObject.className = '';

				var $item;
				if (btnObject.name === 'separator') $item = $('<a class="redactor_separator_drop">');
				else
				{
					$item = $('<a href="#" class="' + btnObject.className + ' redactor_dropdown_' + btnName + '">' + btnObject.title + '</a>');
					$item.on('click', $.proxy(function(e)
					{
						if (e.preventDefault) e.preventDefault();
						if (this.browser('msie')) e.returnValue = false;

						if (btnObject.callback) btnObject.callback.call(this, btnName, $item, btnObject, e);
						if (btnObject.exec) this.execCommand(btnObject.exec, btnName);
						if (btnObject.func) this[btnObject.func](btnName);

						this.buttonActiveObserver();
						if (this.opts.air) this.$air.fadeOut(100);

					}, this));
				}

				$dropdown.append($item);

			}, this));
		},
		dropdownShow: function(e, key)
		{
			if (!this.opts.visual)
			{
				e.preventDefault();
				return false;
			}

			var $button = this.buttonGet(key);

			// Always re-append it to the end of <body> so it always has the highest sub-z-index.
			var $dropdown  = $button.data('dropdown').appendTo(document.body);

			if ($button.hasClass('dropact')) this.dropdownHideAll();
			else
			{
				this.dropdownHideAll();
				this.callback('dropdownShow', { dropdown: $dropdown, key: key, button: $button });

				this.buttonActive(key);
				$button.addClass('dropact');

				var keyPosition = $button.offset();

				// fix right placement
				var dropdownWidth = $dropdown.width();
				if ((keyPosition.left + dropdownWidth) > $(document).width())
				{
					keyPosition.left -= dropdownWidth;
				}

				var left = keyPosition.left + 'px';
				var btnHeight = $button.innerHeight();

				var position = 'absolute';
				var top = (btnHeight + this.opts.toolbarFixedTopOffset) + 'px';

				if (this.opts.toolbarFixed && this.toolbarFixed) position = 'fixed';
				else top = keyPosition.top + btnHeight + 'px';

				$dropdown.css({ position: position, left: left, top: top }).show();
				this.callback('dropdownShown', { dropdown: $dropdown, key: key, button: $button });
			}


			var hdlHideDropDown = $.proxy(function(e)
			{

				this.dropdownHide(e, $dropdown);

			}, this);

			$(document).one('click', hdlHideDropDown);
			this.$editor.one('click', hdlHideDropDown);
			this.$editor.one('touchstart', hdlHideDropDown);


			e.stopPropagation();
			this.focusWithSaveScroll();
		},
		dropdownHideAll: function()
		{
			this.$toolbar.find('a.dropact').removeClass('redactor_act').removeClass('dropact');
			$('.redactor_dropdown').hide();
			this.callback('dropdownHide');
		},
		dropdownHide: function (e, $dropdown)
		{
			if (!$(e.target).hasClass('dropact'))
			{
				$dropdown.removeClass('dropact');
				this.dropdownHideAll();
			}
		},

		// BUTTONS
		buttonBuild: function(btnName, btnObject, buttonImage)
		{
			var $button = $('<a href="javascript:;" title="' + btnObject.title + '" tabindex="-1" class="re-icon re-' + btnName + '"></a>');

			if (typeof buttonImage != 'undefined')
			{
				$button.addClass('redactor-btn-image');
			}

			$button.on('click', $.proxy(function(e)
			{
				if (e.preventDefault) e.preventDefault();
				if (this.browser('msie')) e.returnValue = false;

				if ($button.hasClass('redactor_button_disabled')) return false;

				if (this.isFocused() === false && !btnObject.exec)
				{
					this.focusWithSaveScroll();
				}

				if (btnObject.exec)
				{
					this.focusWithSaveScroll();

					this.execCommand(btnObject.exec, btnName);
					this.airBindMousemoveHide();

				}
				else if (btnObject.func && btnObject.func !== 'show')
				{
					this[btnObject.func](btnName);
					this.airBindMousemoveHide();

				}
				else if (btnObject.callback)
				{
					btnObject.callback.call(this, btnName, $button, btnObject, e);
					this.airBindMousemoveHide();

				}
				else if (btnObject.dropdown)
				{
					this.dropdownShow(e, btnName);
				}

				this.buttonActiveObserver(false, btnName);

			}, this));

			// dropdown
			if (btnObject.dropdown)
			{
				var $dropdown = $('<div class="redactor_dropdown redactor_dropdown_box_' + btnName + '" style="display: none;">');
				$button.data('dropdown', $dropdown);
				this.dropdownBuild($dropdown, btnObject.dropdown);
			}

			return $button;
		},
		buttonGet: function(key)
		{
			if (!this.opts.toolbar) return false;
			return $(this.$toolbar.find('a.re-' + key));
		},
		buttonTagToActiveState: function(buttonName, tagName)
		{
			this.opts.activeButtons.push(buttonName);
			this.opts.activeButtonsStates[tagName] = buttonName;
		},
		buttonActiveToggle: function(key)
		{
			var btn = this.buttonGet(key);

			if (btn.hasClass('redactor_act'))
			{
				this.buttonInactive(key);
			}
			else
			{
				this.buttonActive(key);
			}
		},
		buttonActive: function(key)
		{
			var btn = this.buttonGet(key);
			btn.addClass('redactor_act');
		},
		buttonInactive: function(key)
		{
			var btn = this.buttonGet(key);
			btn.removeClass('redactor_act');
		},
		buttonInactiveAll: function(btnName)
		{
			this.$toolbar.find('a.re-icon').not('.re-' + btnName).removeClass('redactor_act');
		},
		buttonActiveVisual: function()
		{
			this.$toolbar.find('a.re-icon').not('a.re-html').removeClass('redactor_button_disabled');
		},
		buttonInactiveVisual: function()
		{
			this.$toolbar.find('a.re-icon').not('a.re-html').addClass('redactor_button_disabled');
		},
		buttonChangeIcon: function (key, classname)
		{
			this.buttonGet(key).addClass('re-' + classname);
		},
		buttonRemoveIcon: function(key, classname)
		{
			this.buttonGet(key).removeClass('re-' + classname);
		},
		buttonAwesome: function(key, name)
		{
			var button = this.buttonGet(key);
			button.removeClass('redactor-btn-image');
			button.addClass('fa-redactor-btn');
			button.html('<i class="fa ' + name + '"></i>');
		},
		buttonAdd: function(key, title, callback, dropdown)
		{
			if (!this.opts.toolbar) return;
			var btn = this.buttonBuild(key, { title: title, callback: callback, dropdown: dropdown }, true);

			this.$toolbar.append($('<li>').append(btn));

			return btn;
		},
		buttonAddFirst: function(key, title, callback, dropdown)
		{
			if (!this.opts.toolbar) return;
			var btn = this.buttonBuild(key, { title: title, callback: callback, dropdown: dropdown }, true);
			this.$toolbar.prepend($('<li>').append(btn));
		},
		buttonAddAfter: function(afterkey, key, title, callback, dropdown)
		{
			if (!this.opts.toolbar) return;
			var btn = this.buttonBuild(key, { title: title, callback: callback, dropdown: dropdown }, true);
			var $btn = this.buttonGet(afterkey);

			if ($btn.size() !== 0) $btn.parent().after($('<li>').append(btn));
			else this.$toolbar.append($('<li>').append(btn));

			return btn;
		},
		buttonAddBefore: function(beforekey, key, title, callback, dropdown)
		{
			if (!this.opts.toolbar) return;
			var btn = this.buttonBuild(key, { title: title, callback: callback, dropdown: dropdown }, true);
			var $btn = this.buttonGet(beforekey);

			if ($btn.size() !== 0) $btn.parent().before($('<li>').append(btn));
			else this.$toolbar.append($('<li>').append(btn));

			return btn;
		},
		buttonRemove: function (key)
		{
			var $btn = this.buttonGet(key);
			$btn.remove();
		},
		buttonActiveObserver: function(e, btnName)
		{
			var parent = this.getParent();
			this.buttonInactiveAll(btnName);

			if (e === false && btnName !== 'html')
			{
				if ($.inArray(btnName, this.opts.activeButtons) != -1)
				{
					this.buttonActiveToggle(btnName);
				}
				return;
			}

			if (parent && parent.tagName === 'A') this.$toolbar.find('a.redactor_dropdown_link').text(this.opts.curLang.link_edit);
			else this.$toolbar.find('a.redactor_dropdown_link').text(this.opts.curLang.link_insert);

			$.each(this.opts.activeButtonsStates, $.proxy(function(key, value)
			{
				if ($(parent).closest(key, this.$editor.get()[0]).length != 0)
				{
					this.buttonActive(value);
				}

			}, this));

			var $parent = $(parent).closest(this.opts.alignmentTags.toString().toLowerCase(), this.$editor[0]);
			if ($parent.length)
			{
				var align = $parent.css('text-align');
				if (align == '')
				{
					align = 'left';
				}

				this.buttonActive('align' + align);
			}
		},

		// EXEC
		execPasteFrag: function(html)
		{
			var sel = this.getSelection();
			if (sel.getRangeAt && sel.rangeCount)
			{
				var range = this.getRange();
				range.deleteContents();

				var el = this.document.createElement("div");
				el.innerHTML = html;

				var frag = this.document.createDocumentFragment(), node, lastNode;
				while ((node = el.firstChild))
				{
					lastNode = frag.appendChild(node);
				}

				var firstNode = frag.firstChild;
				range.insertNode(frag);

				if (lastNode)
				{
					range = range.cloneRange();
					range.setStartAfter(lastNode);
					range.collapse(true);
				}
				sel.removeAllRanges();
				sel.addRange(range);
			}
		},
		exec: function(cmd, param, sync)
		{
			if (cmd === 'formatblock' && this.browser('msie'))
			{
				param = '<' + param + '>';
			}

			if (cmd === 'inserthtml' && this.browser('msie'))
			{
				if (!this.isIe11())
				{
					this.focusWithSaveScroll();
					this.document.selection.createRange().pasteHTML(param);
				}
				else this.execPasteFrag(param);
			}
			else
			{
				this.document.execCommand(cmd, false, param);
			}

			if (sync !== false) this.sync();
			this.callback('execCommand', cmd, param);
		},
		execCommand: function(cmd, param, sync)
		{
			if (!this.opts.visual)
			{
				this.$source.focus();
				return false;
			}

			if (   cmd === 'bold'
				|| cmd === 'italic'
				|| cmd === 'underline'
				|| cmd === 'strikethrough')
			{
				this.bufferSet();
			}


			if (cmd === 'superscript' || cmd === 'subscript')
			{
				var parent = this.getParent();
				if (parent.tagName === 'SUP' || parent.tagName === 'SUB')
				{
					this.inlineRemoveFormatReplace(parent);
				}
			}

			if (cmd === 'inserthtml')
			{
				this.insertHtml(param, sync);
				this.callback('execCommand', cmd, param);
				return;
			}

			// Stop formatting pre
			if (this.currentOrParentIs('PRE') && !this.opts.formattingPre) return false;

			// Lists
			if (cmd === 'insertunorderedlist' || cmd === 'insertorderedlist') return this.execLists(cmd, param);

			// Unlink
			if (cmd === 'unlink') return this.execUnlink(cmd, param);

			// Usual exec
			this.exec(cmd, param, sync);

			// Line
			if (cmd === 'inserthorizontalrule') this.$editor.find('hr').removeAttr('id');

		},
		execUnlink: function(cmd, param)
		{
			this.bufferSet();

			var link = this.currentOrParentIs('A');
			if (link)
			{
				$(link).replaceWith($(link).text());

				this.sync();
				this.callback('execCommand', cmd, param);
				return;
			}
		},
		execLists: function(cmd, param)
		{
			this.bufferSet();

			var parent = this.getParent();
			var $list = $(parent).closest('ol, ul');

			if (!this.isParentRedactor($list) && $list.size() != 0)
			{
				$list = false;
			}

			var remove = false;

			if ($list && $list.length)
			{
				remove = true;
				var listTag = $list[0].tagName;
			 	if ((cmd === 'insertunorderedlist' && listTag === 'OL')
			 	|| (cmd === 'insertorderedlist' && listTag === 'UL'))
			 	{
				 	remove = false;
				}
			}

			this.selectionSave();

			// remove lists
			if (remove)
			{

				var nodes = this.getNodes();
				var elems = this.getBlocks(nodes);

				if (typeof nodes[0] != 'undefined' && nodes.length > 1 && nodes[0].nodeType == 3)
				{
					// fix the adding the first li to the array
					elems.unshift(this.getBlock());
				}

				var data = '', replaced = '';
				$.each(elems, $.proxy(function(i,s)
				{
					if (s.tagName == 'LI')
					{
						var $s = $(s);
						var cloned = $s.clone();
						cloned.find('ul', 'ol').remove();

						if (this.opts.linebreaks === false)
						{
							data += this.outerHtml($('<p>').append(cloned.contents()));
						}
						else
						{
							var clonedHtml = cloned.html().replace(/<br\s?\/?>$/i, '');
							data += clonedHtml + '<br>';
						}

						if (i == 0)
						{
							$s.addClass('redactor-replaced').empty();
							replaced = this.outerHtml($s);
						}
						else $s.remove();
					}

				}, this));


				html = this.$editor.html().replace(replaced, '</' + listTag + '>' + data + '<' + listTag + '>');

				this.$editor.html(html);
				this.$editor.find(listTag + ':empty').remove();

			}

			// insert lists
			else
			{
				var firstParent = $(this.getParent()).closest('td');

				if (this.browser('msie') && !this.isIe11() && this.opts.linebreaks)
				{
					var wrapper = this.selectionWrap('div');
					var wrapperHtml = $(wrapper).html();
					var tmpList = $('<ul>');
					if (cmd == 'insertorderedlist')
					{
						tmpList = $('<ol>');
					}

					var tmpLi = $('<li>');

					if ($.trim(wrapperHtml) == '')
					{
						tmpLi.append(wrapperHtml + '<span id="selection-marker-1">' + this.opts.invisibleSpace + '</span>');
						tmpList.append(tmpLi);
						this.$editor.find('#selection-marker-1').replaceWith(tmpList);
					}
					else
					{
						tmpLi.append(wrapperHtml);
						tmpList.append(tmpLi);
						$(wrapper).replaceWith(tmpList);
					}
				}
				else
				{
					this.document.execCommand(cmd);
				}

				var parent = this.getParent();
				var $list = $(parent).closest('ol, ul');

				if (this.opts.linebreaks === false)
				{
					var listText = $.trim($list.text());
					if (listText == '')
					{
						$list.children('li').find('br').remove();
						$list.children('li').append('<span id="selection-marker-1">' + this.opts.invisibleSpace + '</span>');
					}
				}

				if (firstParent.size() != 0)
				{
					$list.wrapAll('<td>');
				}

				if ($list.length)
				{
					// remove block-element list wrapper
					var $listParent = $list.parent();
					if (this.isParentRedactor($listParent) && $listParent[0].tagName != 'LI' && this.nodeTestBlocks($listParent[0]))
					{
						$listParent.replaceWith($listParent.contents());
					}
				}

				if (this.browser('mozilla'))
				{
					this.$editor.focus();
				}
			}

			this.selectionRestore();
			this.$editor.find('#selection-marker-1').removeAttr('id');
			this.sync();
			this.callback('execCommand', cmd, param);
			return;
		},

		// INDENTING
		indentingIndent: function()
		{
			this.indentingStart('indent');
		},
		indentingOutdent: function()
		{
			this.indentingStart('outdent');
		},
		indentingStart: function(cmd)
		{
			this.bufferSet();

			if (cmd === 'indent')
			{
				var block = this.getBlock();

				this.selectionSave();

				if (block && block.tagName == 'LI')
				{
					// li
					var parent = this.getParent();

					var $list = $(parent).closest('ol, ul');
					var listTag = $list[0].tagName;

					var elems = this.getBlocks();

					$.each(elems, function(i,s)
					{
						if (s.tagName == 'LI')
						{
							var $prev = $(s).prev();
							if ($prev.size() != 0 && $prev[0].tagName == 'LI')
							{
								var $childList = $prev.children('ul, ol');
								if ($childList.size() == 0)
								{
									$prev.append($('<' + listTag + '>').append(s));
								}
								else $childList.append(s);
							}
						}
					});
				}
				// linebreaks
				else if (block === false && this.opts.linebreaks === true)
				{
					this.exec('formatBlock', 'blockquote');
					var newblock = this.getBlock();
					var block = $('<div data-tagblock="">').html($(newblock).html());
					$(newblock).replaceWith(block);

					var left = this.normalize($(block).css('margin-left')) + this.opts.indentValue;
					$(block).css('margin-left', left + 'px');
				}
				else
				{
					// all block tags
					var elements = this.getBlocks();
					$.each(elements, $.proxy(function(i, elem)
					{
						var $el = false;

						if (elem.tagName === 'TD') return;

						if ($.inArray(elem.tagName, this.opts.alignmentTags) !== -1)
						{
							$el = $(elem);
						}
						else
						{
							$el = $(elem).closest(this.opts.alignmentTags.toString().toLowerCase(), this.$editor[0]);
						}

						var left = this.normalize($el.css('margin-left')) + this.opts.indentValue;
						$el.css('margin-left', left + 'px');

					}, this));
				}

				this.selectionRestore();

			}
			// outdent
			else
			{
				this.selectionSave();

				var block = this.getBlock();
				if (block && block.tagName == 'LI')
				{
					// li
					var elems = this.getBlocks();
					var index = 0;

					this.insideOutdent(block, index, elems);
				}
				else
				{
					// all block tags
					var elements = this.getBlocks();
					$.each(elements, $.proxy(function(i, elem)
					{
						var $el = false;

						if ($.inArray(elem.tagName, this.opts.alignmentTags) !== -1)
						{
							$el = $(elem);
						}
						else
						{
							$el = $(elem).closest(this.opts.alignmentTags.toString().toLowerCase(), this.$editor[0]);
						}

						var left = this.normalize($el.css('margin-left')) - this.opts.indentValue;
						if (left <= 0)
						{
							// linebreaks
							if (this.opts.linebreaks === true && typeof($el.data('tagblock')) !== 'undefined')
							{
								$el.replaceWith($el.html() + '<br>');
							}
							// all block tags
							else
							{
								$el.css('margin-left', '');
								this.removeEmptyAttr($el, 'style');
							}
						}
						else
						{
							$el.css('margin-left', left + 'px');
						}

					}, this));
				}


				this.selectionRestore();
			}

			this.sync();

		},
		insideOutdent: function (li, index, elems)
		{
			if (li && li.tagName == 'LI')
			{
				var $parent = $(li).parent().parent();
				if ($parent.size() != 0 && $parent[0].tagName == 'LI')
				{
					$parent.after(li);
				}
				else
				{
					if (typeof elems[index] != 'undefined')
					{
						li = elems[index];
						index++;

						this.insideOutdent(li, index, elems);
					}
					else
					{
						this.execCommand('insertunorderedlist');
					}
				}
			}
		},

		// ALIGNMENT
		alignmentLeft: function()
		{
			this.alignmentSet('', 'JustifyLeft');
		},
		alignmentRight: function()
		{
			this.alignmentSet('right', 'JustifyRight');
		},
		alignmentCenter: function()
		{
			this.alignmentSet('center', 'JustifyCenter');
		},
		alignmentJustify: function()
		{
			this.alignmentSet('justify', 'JustifyFull');
		},
		alignmentSet: function(type, cmd)
		{
			this.bufferSet();

			if (this.oldIE())
			{
				this.document.execCommand(cmd, false, false);
				return true;
			}

			this.selectionSave();

			var block = this.getBlock();
			if (!block && this.opts.linebreaks)
			{
				// one element
				this.exec('formatblock', 'div');

				var newblock = this.getBlock();
				var block = $('<div data-tagblock="">').html($(newblock).html());
				$(newblock).replaceWith(block);

				$(block).css('text-align', type);
				this.removeEmptyAttr(block, 'style');

				if (type == '' && typeof($(block).data('tagblock')) !== 'undefined')
				{
					$(block).replaceWith($(block).html());
				}
			}
			else
			{
				var elements = this.getBlocks();
				$.each(elements, $.proxy(function(i, elem)
				{
					var $el = false;

					if ($.inArray(elem.tagName, this.opts.alignmentTags) !== -1)
					{
						$el = $(elem);
					}
					else
					{
						$el = $(elem).closest(this.opts.alignmentTags.toString().toLowerCase(), this.$editor[0]);
					}

					if ($el)
					{
						$el.css('text-align', type);
						this.removeEmptyAttr($el, 'style');
					}

				}, this));
			}

			this.selectionRestore();
			this.sync();
		},

		// CLEAN
		cleanEmpty: function(html)
		{
			var ph = this.placeholderStart(html);
			if (ph !== false) return ph;

			if (this.opts.linebreaks === false)
			{
				if (html === '') html = this.opts.emptyHtml;
				else if (html.search(/^<hr\s?\/?>$/gi) !== -1) html = '<hr>' + this.opts.emptyHtml;
			}

			return html;
		},
		cleanConverters: function(html)
		{
			// convert div to p
			if (this.opts.convertDivs && !this.opts.gallery)
			{
				html = html.replace(/<div(.*?)>([\w\W]*?)<\/div>/gi, '<p$1>$2</p>');
			}

			if (this.opts.paragraphy) html = this.cleanParagraphy(html);

			return html;
		},
		cleanConvertProtected: function(html)
		{
			if (this.opts.templateVars)
			{
				html = html.replace(/\{\{(.*?)\}\}/gi, '<!-- template double $1 -->');
				html = html.replace(/\{(.*?)\}/gi, '<!-- template $1 -->');
			}

			html = html.replace(/<script(.*?)>([\w\W]*?)<\/script>/gi, '<title type="text/javascript" style="display: none;" class="redactor-script-tag"$1>$2</title>');
			html = html.replace(/<style(.*?)>([\w\W]*?)<\/style>/gi, '<section$1 style="display: none;" rel="redactor-style-tag">$2</section>');
			html = html.replace(/<form(.*?)>([\w\W]*?)<\/form>/gi, '<section$1 rel="redactor-form-tag">$2</section>');

			// php tags convertation
			if (this.opts.phpTags) html = html.replace(/<\?php([\w\W]*?)\?>/gi, '<section style="display: none;" rel="redactor-php-tag">$1</section>');
			else html = html.replace(/<\?php([\w\W]*?)\?>/gi, '');

			return html;
		},
		cleanReConvertProtected: function(html)
		{
			if (this.opts.templateVars)
			{
				html = html.replace(/<!-- template double (.*?) -->/gi, '{{$1}}');
				html = html.replace(/<!-- template (.*?) -->/gi, '{$1}');
			}

			html = html.replace(/<title type="text\/javascript" style="display: none;" class="redactor-script-tag"(.*?)>([\w\W]*?)<\/title>/gi, '<script$1 type="text/javascript">$2</script>');
			html = html.replace(/<section(.*?) style="display: none;" rel="redactor-style-tag">([\w\W]*?)<\/section>/gi, '<style$1>$2</style>');
			html = html.replace(/<section(.*?)rel="redactor-form-tag"(.*?)>([\w\W]*?)<\/section>/gi, '<form$1$2>$3</form>');

			// php tags convertation
			if (this.opts.phpTags) html = html.replace(/<section style="display: none;" rel="redactor-php-tag">([\w\W]*?)<\/section>/gi, '<?php\r\n$1\r\n?>');

			return html;
		},
		cleanRemoveSpaces: function(html, buffer)
		{
			if (buffer !== false)
			{
				var buffer = []
				var matches = html.match(/<(pre|style|script|title)(.*?)>([\w\W]*?)<\/(pre|style|script|title)>/gi);
				if (matches === null) matches = [];

				if (this.opts.phpTags)
				{
					var phpMatches = html.match(/<\?php([\w\W]*?)\?>/gi);
					if (phpMatches) matches = $.merge(matches, phpMatches);
				}

				if (matches)
				{
					$.each(matches, function(i, s)
					{
						html = html.replace(s, 'buffer_' + i);
						buffer.push(s);
					});
				}
			}

			html = html.replace(/\n/g, ' ');
			html = html.replace(/[\t]*/g, '');
			html = html.replace(/\n\s*\n/g, "\n");
			html = html.replace(/^[\s\n]*/g, ' ');
			html = html.replace(/[\s\n]*$/g, ' ');
			html = html.replace( />\s{2,}</g, '> <'); // between inline tags can be only one space

			html = this.cleanReplacer(html, buffer);

			html = html.replace(/\n\n/g, "\n");

			return html;
		},
		cleanReplacer: function(html, buffer)
		{
			if (buffer === false) return html;

			$.each(buffer, function(i,s)
			{
				html = html.replace('buffer_' + i, s);
			});

			return html;
		},
		cleanRemoveEmptyTags: function(html)
		{
			// remove zero width-space
			html = html.replace(/[\u200B-\u200D\uFEFF]/g, '');

			var etagsInline = ["<b>\\s*</b>", "<b>&nbsp;</b>", "<em>\\s*</em>"]
			var etags = ["<pre></pre>", "<blockquote>\\s*</blockquote>", "<dd></dd>", "<dt></dt>", "<ul></ul>", "<ol></ol>", "<li></li>", "<table></table>", "<tr></tr>", "<span>\\s*<span>", "<span>&nbsp;<span>", "<p>\\s*</p>", "<p></p>", "<p>&nbsp;</p>",  "<p>\\s*<br>\\s*</p>", "<div>\\s*</div>", "<div>\\s*<br>\\s*</div>"];

			if (this.opts.removeEmptyTags)
			{
				etags = etags.concat(etagsInline);
			}
			else etags = etagsInline;

			var len = etags.length;
			for (var i = 0; i < len; ++i)
			{
				html = html.replace(new RegExp(etags[i], 'gi'), "");
			}

			return html;
		},
		cleanParagraphy: function(html)
		{
			html = $.trim(html);

			if (this.opts.linebreaks === true) return html;
			if (html === '' || html === '<p></p>') return this.opts.emptyHtml;

			html = html + "\n";

			if (this.opts.removeEmptyTags === false)
			{
				return html;
			}

			var safes = [];
			var matches = html.match(/<(table|div|pre|object)(.*?)>([\w\W]*?)<\/(table|div|pre|object)>/gi);
			if (!matches) matches = [];

			var commentsMatches = html.match(/<!--([\w\W]*?)-->/gi);
			if (commentsMatches) matches = $.merge(matches, commentsMatches);

			if (this.opts.phpTags)
			{
				var phpMatches = html.match(/<section(.*?)rel="redactor-php-tag">([\w\W]*?)<\/section>/gi);
				if (phpMatches) matches = $.merge(matches, phpMatches);
			}

			if (matches)
			{
				$.each(matches, function(i,s)
				{
					safes[i] = s;
					html = html.replace(s, '{replace' + i + '}\n');
				});
			}

			html = html.replace(/<br \/>\s*<br \/>/gi, "\n\n");
			html = html.replace(/<br><br>/gi, "\n\n");

			function R(str, mod, r)
			{
				return html.replace(new RegExp(str, mod), r);
			}

			var blocks = '(comment|html|body|head|title|meta|style|script|link|iframe|table|thead|tfoot|caption|col|colgroup|tbody|tr|td|th|div|dl|dd|dt|ul|ol|li|pre|select|option|form|map|area|blockquote|address|math|style|p|h[1-6]|hr|fieldset|legend|section|article|aside|hgroup|header|footer|nav|figure|figcaption|details|menu|summary)';

			html = R('(<' + blocks + '[^>]*>)', 'gi', "\n$1");
			html = R('(</' + blocks + '>)', 'gi', "$1\n\n");
			html = R("\r\n", 'g', "\n");
			html = R("\r", 'g', "\n");
			html = R("/\n\n+/", 'g', "\n\n");

			var htmls = html.split(new RegExp('\n\s*\n', 'g'), -1);

			html = '';
			for (var i in htmls)
			{
				if (htmls.hasOwnProperty(i))
                {
					if (htmls[i].search('{replace') == -1)
					{
						htmls[i] = htmls[i].replace(/<p>\n\t?<\/p>/gi, '');
						htmls[i] = htmls[i].replace(/<p><\/p>/gi, '');

						if (htmls[i] != '')
						{
							html += '<p>' +  htmls[i].replace(/^\n+|\n+$/g, "") + "</p>";
						}
					}
					else html += htmls[i];
				}
			}

			html = R('<p><p>', 'gi', '<p>');
			html = R('</p></p>', 'gi', '</p>');

			html = R('<p>\s?</p>', 'gi', '');

			html = R('<p>([^<]+)</(div|address|form)>', 'gi', "<p>$1</p></$2>");

			html = R('<p>(</?' + blocks + '[^>]*>)</p>', 'gi', "$1");
			html = R("<p>(<li.+?)</p>", 'gi', "$1");
			html = R('<p>\s?(</?' + blocks + '[^>]*>)', 'gi', "$1");

			html = R('(</?' + blocks + '[^>]*>)\s?</p>', 'gi', "$1");
			html = R('(</?' + blocks + '[^>]*>)\s?<br />', 'gi', "$1");
			html = R('<br />(\s*</?(?:p|li|div|dl|dd|dt|th|pre|td|ul|ol)[^>]*>)', 'gi', '$1');
			html = R("\n</p>", 'gi', '</p>');

			html = R('<li><p>', 'gi', '<li>');
			html = R('</p></li>', 'gi', '</li>');
			html = R('</li><p>', 'gi', '</li>');
			//html = R('</ul><p>(.*?)</li>', 'gi', '</ul></li>');
			// html = R('</ol><p>', 'gi', '</ol>');
			html = R('<p>\t?\n?<p>', 'gi', '<p>');
			html = R('</dt><p>', 'gi', '</dt>');
			html = R('</dd><p>', 'gi', '</dd>');
			html = R('<br></p></blockquote>', 'gi', '</blockquote>');
			html = R('<p>\t*</p>', 'gi', '');

			// restore safes
			$.each(safes, function(i,s)
			{
				html = html.replace('{replace' + i + '}', s);
			});

			return $.trim(html);
		},
		cleanConvertInlineTags: function(html, set)
		{
			var boldTag = 'strong';
			if (this.opts.boldTag === 'b') boldTag = 'b';

			var italicTag = 'em';
			if (this.opts.italicTag === 'i') italicTag = 'i';

			html = html.replace(/<span style="font-style: italic;">([\w\W]*?)<\/span>/gi, '<' + italicTag + '>$1</' + italicTag + '>');
			html = html.replace(/<span style="font-weight: bold;">([\w\W]*?)<\/span>/gi, '<' + boldTag + '>$1</' + boldTag + '>');

			// bold, italic, del
			if (this.opts.boldTag === 'strong') html = html.replace(/<b>([\w\W]*?)<\/b>/gi, '<strong>$1</strong>');
			else html = html.replace(/<strong>([\w\W]*?)<\/strong>/gi, '<b>$1</b>');

			if (this.opts.italicTag === 'em') html = html.replace(/<i>([\w\W]*?)<\/i>/gi, '<em>$1</em>');
			else html = html.replace(/<em>([\w\W]*?)<\/em>/gi, '<i>$1</i>');

			html = html.replace(/<span style="text-decoration: underline;">([\w\W]*?)<\/span>/gi, '<u>$1</u>');

			if (set !== true) html = html.replace(/<strike>([\w\W]*?)<\/strike>/gi, '<del>$1</del>');
			else html = html.replace(/<del>([\w\W]*?)<\/del>/gi, '<strike>$1</strike>');

			return html;
		},
		cleanStripTags: function(html)
		{
			if (html == '' || typeof html == 'undefined') return html;

			var allowed = false;
			if (this.opts.allowedTags !== false) allowed = true;

			var arr = allowed === true ? this.opts.allowedTags : this.opts.deniedTags;

			var tags = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
			html = html.replace(tags, function ($0, $1)
			{
				if (allowed === true) return $.inArray($1.toLowerCase(), arr) > '-1' ? $0 : '';
				else return $.inArray($1.toLowerCase(), arr) > '-1' ? '' : $0;
			});

			html = this.cleanConvertInlineTags(html);

			return html;

		},
		cleanSavePreCode: function(html, encode)
		{
			var pre = html.match(/<(pre|code)(.*?)>([\w\W]*?)<\/(pre|code)>/gi);
			if (pre !== null)
			{
				$.each(pre, $.proxy(function(i,s)
				{
					var arr = s.match(/<(pre|code)(.*?)>([\w\W]*?)<\/(pre|code)>/i);

					arr[3] = arr[3].replace(/&nbsp;/g, ' ');

					if (encode !== false) arr[3] = this.cleanEncodeEntities(arr[3]);

					// $ fix
					arr[3] = arr[3].replace(/\$/g, '&#36;');

					html = html.replace(s, '<' + arr[1] + arr[2] + '>' + arr[3] + '</' + arr[1] + '>');

				}, this));
			}

			return html;
		},
		cleanEncodeEntities: function(str)
		{
			str = String(str).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
			return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
		},
		cleanUnverified: function()
		{
			// label, abbr, mark, meter, code, q, dfn, ins, time, kbd, var
			var $elem = this.$editor.find('li, img, a, b, strong, sub, sup, i, em, u, small, strike, del, span, cite');

			$elem.filter('[style*="background-color: transparent;"][style*="line-height"]')
			.css('background-color', '')
			.css('line-height', '');

			$elem.filter('[style*="background-color: transparent;"]')
			.css('background-color', '');

			$elem.css('line-height', '');

			$.each($elem, $.proxy(function(i,s)
			{
				this.removeEmptyAttr(s, 'style');
			}, this));

			var $elem2 = this.$editor.find('b, strong, i, em, u, strike, del');
			$elem2.css('font-size', '');

			$.each($elem2, $.proxy(function(i,s)
			{
				this.removeEmptyAttr(s, 'style');
			}, this));

			// When we paste text in Safari is wrapping inserted div (remove it)
			this.$editor.find('div[style="text-align: -webkit-auto;"]').contents().unwrap();

			// Remove all styles in ul, ol, li
			this.$editor.find('ul, ol, li').removeAttr('style');
		},


		// TEXTAREA CODE FORMATTING
		cleanHtml: function(code)
		{
			var i = 0,
			codeLength = code.length,
			point = 0,
			start = null,
			end = null,
			tag = '',
			out = '',
			cont = '';

			this.cleanlevel = 0;

			for (; i < codeLength; i++)
			{
				point = i;

				// if no more tags, copy and exit
				if (-1 == code.substr(i).indexOf( '<' ))
				{
					out += code.substr(i);

					return this.cleanFinish(out);
				}

				// copy verbatim until a tag
				while (point < codeLength && code.charAt(point) != '<')
				{
					point++;
				}

				if (i != point)
				{
					cont = code.substr(i, point - i);
					if (!cont.match(/^\s{2,}$/g))
					{
						if ('\n' == out.charAt(out.length - 1)) out += this.cleanGetTabs();
						else if ('\n' == cont.charAt(0))
						{
							out += '\n' + this.cleanGetTabs();
							cont = cont.replace(/^\s+/, '');
						}

						out += cont;
					}

					if (cont.match(/\n/)) out += '\n' + this.cleanGetTabs();
				}

				start = point;

				// find the end of the tag
				while (point < codeLength && '>' != code.charAt(point))
				{
					point++;
				}

				tag = code.substr(start, point - start);
				i = point;

				var t;

				if ('!--' == tag.substr(1, 3))
				{
					if (!tag.match(/--$/))
					{
						while ('-->' != code.substr(point, 3))
						{
							point++;
						}
						point += 2;
						tag = code.substr(start, point - start);
						i = point;
					}

					if ('\n' != out.charAt(out.length - 1)) out += '\n';

					out += this.cleanGetTabs();
					out += tag + '>\n';
				}
				else if ('!' == tag[1])
				{
					out = this.placeTag(tag + '>', out);
				}
				else if ('?' == tag[1])
				{
					out += tag + '>\n';
				}
				else if (t = tag.match(/^<(script|style|pre)/i))
				{
					t[1] = t[1].toLowerCase();
					tag = this.cleanTag(tag);
					out = this.placeTag(tag, out);
					end = String(code.substr(i + 1)).toLowerCase().indexOf('</' + t[1]);

					if (end)
					{
						cont = code.substr(i + 1, end);
						i += end;
						out += cont;
					}
				}
				else
				{
					tag = this.cleanTag(tag);
					out = this.placeTag(tag, out);
				}
			}

			return this.cleanFinish(out);
		},
		cleanGetTabs: function()
		{
			var s = '';
			for ( var j = 0; j < this.cleanlevel; j++ )
			{
				s += '\t';
			}

			return s;
		},
		cleanFinish: function(code)
		{
			code = code.replace(/\n\s*\n/g, '\n');
			code = code.replace(/^[\s\n]*/, '');
			code = code.replace(/[\s\n]*$/, '');
			code = code.replace(/<script(.*?)>\n<\/script>/gi, '<script$1></script>');

			this.cleanlevel = 0;

			return code;
		},
		cleanTag: function (tag)
		{
			var tagout = '';
			tag = tag.replace(/\n/g, ' ');
			tag = tag.replace(/\s{2,}/g, ' ');
			tag = tag.replace(/^\s+|\s+$/g, ' ');

			var suffix = '';
			if (tag.match(/\/$/))
			{
				suffix = '/';
				tag = tag.replace(/\/+$/, '');
			}

			var m;
			while (m = /\s*([^= ]+)(?:=((['"']).*?\3|[^ ]+))?/.exec(tag))
			{
				if (m[2]) tagout += m[1].toLowerCase() + '=' + m[2];
				else if (m[1]) tagout += m[1].toLowerCase();

				tagout += ' ';
				tag = tag.substr(m[0].length);
			}

			return tagout.replace(/\s*$/, '') + suffix + '>';
		},
		placeTag: function (tag, out)
		{
			var nl = tag.match(this.cleannewLevel);
			if (tag.match(this.cleanlineBefore) || nl)
			{
				out = out.replace(/\s*$/, '');
				out += '\n';
			}

			if (nl && '/' == tag.charAt(1)) this.cleanlevel--;
			if ('\n' == out.charAt(out.length - 1)) out += this.cleanGetTabs();
			if (nl && '/' != tag.charAt(1)) this.cleanlevel++;

			out += tag;

			if (tag.match(this.cleanlineAfter) || tag.match(this.cleannewLevel))
			{
				out = out.replace(/ *$/, '');
				out += '\n';
			}

			return out;
		},

		// FORMAT
		formatEmpty: function(e)
		{
			var html = $.trim(this.$editor.html());

			if (this.opts.linebreaks)
			{
				if (html == '')
				{
					e.preventDefault();
					this.$editor.html('');
					this.focus();
				}
			}
			else
			{
				html = html.replace(/<br\s?\/?>/i, '');
				var thtml = html.replace(/<p>\s?<\/p>/gi, '');

				if (html === '' || thtml === '')
				{
					e.preventDefault();

					var node = $(this.opts.emptyHtml).get(0);
					this.$editor.html(node);
					this.focus();
				}
			}

			this.sync();
		},
		formatBlocks: function(tag)
		{
			if (this.browser('mozilla') && this.isFocused())
			{
				this.$editor.focus();
			}

			this.bufferSet();

			var nodes = this.getBlocks();
			this.selectionSave();

			$.each(nodes, $.proxy(function(i, node)
			{
				if (node.tagName !== 'LI')
				{
					var parent = $(node).parent();

					if (tag === 'p')
					{
						if ((node.tagName === 'P'
						&& parent.size() != 0
						&& parent[0].tagName === 'BLOCKQUOTE')
						||
						node.tagName === 'BLOCKQUOTE')
						{
							this.formatQuote();
							return;
						}
						else if (this.opts.linebreaks)
						{
							if (node && node.tagName.search(/H[1-6]/) == 0)
							{
								$(node).replaceWith(node.innerHTML + '<br>');
							}
							else return;
						}
						else
						{
							this.formatBlock(tag, node);
						}
					}
					else
					{
						this.formatBlock(tag, node);
					}
				}

			}, this));

			this.selectionRestore();
			this.sync();
		},
		formatBlock: function(tag, block)
		{
			if (block === false) block = this.getBlock();
			if (block === false && this.opts.linebreaks === true)
			{
				this.execCommand('formatblock', tag);
				return true;
			}

			var contents = '';
			if (tag !== 'pre')
			{
				contents = $(block).contents();
			}
			else
			{
				//contents = this.cleanEncodeEntities($(block).text());
				contents = $(block).html();
				if ($.trim(contents) === '')
				{
					contents = '<span id="selection-marker-1"></span>';
				}
			}

			if (block.tagName === 'PRE') tag = 'p';

			if (this.opts.linebreaks === true && tag === 'p')
			{
				$(block).replaceWith($('<div>').append(contents).html() + '<br>');
			}
			else
			{
				var parent = this.getParent();

				var node = $('<' + tag + '>').append(contents);
				$(block).replaceWith(node);

				if (parent && parent.tagName == 'TD')
				{
					$(node).wrapAll('<td>');
				}
			}
		},
		formatChangeTag: function(fromElement, toTagName, save)
		{
			if (save !== false) this.selectionSave();

			var newElement = $('<' + toTagName + '/>');
			$(fromElement).replaceWith(function() { return newElement.append($(this).contents()); });

			if (save !== false) this.selectionRestore();

			return newElement;
		},

		// QUOTE
		formatQuote: function()
		{
			if (this.browser('mozilla') && this.isFocused())
			{
				this.$editor.focus();
			}

			this.bufferSet();

			// paragraphy
			if (this.opts.linebreaks === false)
			{
				this.selectionSave();

				var blocks = this.getBlocks();

				var blockquote = false;
				var blocksLen = blocks.length;
				if (blocks)
				{
					var data = '';
					var replaced = '';
					var replace = false;
					var paragraphsOnly = true;

					$.each(blocks, function(i,s)
					{
						if (s.tagName !== 'P') paragraphsOnly = false;
					});

					$.each(blocks, $.proxy(function(i,s)
					{
						if (s.tagName === 'BLOCKQUOTE')
						{
							this.formatBlock('p', s, false);
						}
						else if (s.tagName === 'P')
						{
							blockquote = $(s).parent();
							// from blockquote
							if (blockquote[0].tagName == 'BLOCKQUOTE')
							{
								var count = $(blockquote).children('p').size();

								// one
								if (count == 1)
								{
									$(blockquote).replaceWith(s);
								}
								// all
								else if (count == blocksLen)
								{
									replace = 'blockquote';
									data += this.outerHtml(s);
								}
								// some
								else
								{
									replace = 'html';
									data += this.outerHtml(s);

									if (i == 0)
									{
										$(s).addClass('redactor-replaced').empty();
										replaced = this.outerHtml(s);
									}
									else $(s).remove();
								}
							}
							// to blockquote
							else
							{
								if (paragraphsOnly === false || blocks.length == 1)
								{
									this.formatBlock('blockquote', s, false);
								}
								else
								{
									replace = 'paragraphs';
									data += this.outerHtml(s);
								}
							}

						}
						else if (s.tagName !== 'LI')
						{
							this.formatBlock('blockquote', s, false);
						}

					}, this));

					if (replace)
					{
						if (replace == 'paragraphs')
						{
							$(blocks[0]).replaceWith('<blockquote>' + data + '</blockquote>');
							$(blocks).remove();
						}
						else if (replace == 'blockquote')
						{
							$(blockquote).replaceWith(data);
						}
						else if (replace == 'html')
						{
							var html = this.$editor.html().replace(replaced, '</blockquote>' + data + '<blockquote>');

							this.$editor.html(html);
							this.$editor.find('blockquote').each(function()
							{
								if ($.trim($(this).html()) == '') $(this).remove();
							})
						}
					}
				}

				this.selectionRestore();
			}
			// linebreaks
			else
			{
				var block = this.getBlock();
				if (block.tagName === 'BLOCKQUOTE')
				{
					this.selectionSave();

					var html = $.trim($(block).html());
					var selection = $.trim(this.getSelectionHtml());

					html = html.replace(/<span(.*?)id="selection-marker(.*?)<\/span>/gi, '');

					if (html == selection)
					{
						$(block).replaceWith($(block).html() + '<br>');
					}
					else
					{
						// replace
						this.inlineFormat('tmp');
						var tmp = this.$editor.find('tmp');
						tmp.empty();

						var newhtml = this.$editor.html().replace('<tmp></tmp>', '</blockquote><span id="selection-marker-1">' + this.opts.invisibleSpace + '</span>' + selection + '<blockquote>');

						this.$editor.html(newhtml);
						tmp.remove();
						this.$editor.find('blockquote').each(function()
						{
							if ($.trim($(this).html()) == '') $(this).remove();
						})
					}

					this.selectionRestore();
					this.$editor.find('span#selection-marker-1').attr('id', false);
				}
				else
				{
					var wrapper = this.selectionWrap('blockquote');
					var html = $(wrapper).html();

					var blocksElemsRemove = ['ul', 'ol', 'table', 'tr', 'tbody', 'thead', 'tfoot', 'dl'];
					$.each(blocksElemsRemove, function(i,s)
					{
						html = html.replace(new RegExp('<' + s + '(.*?)>', 'gi'), '');
						html = html.replace(new RegExp('</' + s + '>', 'gi'), '');
					});

					var blocksElems = this.opts.blockLevelElements;
					$.each(blocksElems, function(i,s)
					{
						html = html.replace(new RegExp('<' + s + '(.*?)>', 'gi'), '');
						html = html.replace(new RegExp('</' + s + '>', 'gi'), '<br>');
					});

					$(wrapper).html(html);
					this.selectionElement(wrapper);
					var next = $(wrapper).next();
					if (next.size() != 0 && next[0].tagName === 'BR')
					{
						next.remove();
					}
				}
			}

			this.sync();
		},

		// BLOCK
		blockRemoveAttr: function(attr, value)
		{
			var nodes = this.getBlocks();
			$(nodes).removeAttr(attr);

			this.sync();
		},
		blockSetAttr: function(attr, value)
		{
			var nodes = this.getBlocks();
			$(nodes).attr(attr, value);

			this.sync();
		},
		blockRemoveStyle: function(rule)
		{
			var nodes = this.getBlocks();
			$(nodes).css(rule, '');
			this.removeEmptyAttr(nodes, 'style');

			this.sync();
		},
		blockSetStyle: function (rule, value)
		{
			var nodes = this.getBlocks();
			$(nodes).css(rule, value);

			this.sync();
		},
		blockRemoveClass: function(className)
		{
			var nodes = this.getBlocks();
			$(nodes).removeClass(className);
			this.removeEmptyAttr(nodes, 'class');

			this.sync();
		},
		blockSetClass: function(className)
		{
			var nodes = this.getBlocks();
			$(nodes).addClass(className);

			this.sync();
		},

		// INLINE
		inlineRemoveClass: function(className)
		{
			this.selectionSave();

			this.inlineEachNodes(function(node)
			{
				$(node).removeClass(className);
				this.removeEmptyAttr(node, 'class');
			});

			this.selectionRestore();
			this.sync();
		},
		inlineSetClass: function(className)
		{
			var current = this.getCurrent();
			if (!$(current).hasClass(className)) this.inlineMethods('addClass', className);
		},
		inlineRemoveStyle: function (rule)
		{
			this.selectionSave();

			this.inlineEachNodes(function(node)
			{
				$(node).css(rule, '');
				this.removeEmptyAttr(node, 'style');
			});

			this.selectionRestore();
			this.sync();
		},
		inlineSetStyle: function(rule, value)
		{
			this.inlineMethods('css', rule, value);
		},
		inlineRemoveAttr: function (attr)
		{
			this.selectionSave();

			var range = this.getRange(), node = this.getElement(), nodes = this.getNodes();

			if (range.collapsed || range.startContainer === range.endContainer && node)
			{
				nodes = $( node );
			}

			$(nodes).removeAttr(attr);

			this.inlineUnwrapSpan();

			this.selectionRestore();
			this.sync();
		},
		inlineSetAttr: function(attr, value)
		{
			this.inlineMethods('attr', attr, value );
		},
		inlineMethods: function(type, attr, value)
		{
			this.bufferSet();
			this.selectionSave();

			var range = this.getRange()
			var el = this.getElement();

			if ((range.collapsed || range.startContainer === range.endContainer) && el && !this.nodeTestBlocks(el))
			{
				$(el)[type](attr, value);
			}
			else
			{
				var cmd, arg = value;
				switch (attr)
				{
					case 'font-size':
						cmd = 'fontSize';
						arg = 4;
					break;
					case 'font-family':
						cmd = 'fontName';
					break;
					case 'color':
						cmd = 'foreColor';
					break;
					case 'background-color':
						cmd = 'backColor';
					break;
				}

				this.document.execCommand(cmd, false, arg);

				var fonts = this.$editor.find('font');
				$.each(fonts, $.proxy(function(i, s)
				{
					this.inlineSetMethods(type, s, attr, value);

				}, this));

			}

			this.selectionRestore();
			this.sync();
		},
		inlineSetMethods: function(type, s, attr, value)
		{
			var parent = $(s).parent(), el;

			var selectionHtml = this.getSelectionText();
			var parentHtml = $(parent).text();
			var selected = selectionHtml == parentHtml;

			if (selected && parent && parent[0].tagName === 'INLINE' && parent[0].attributes.length != 0)
			{
				el = parent;
				$(s).replaceWith($(s).html());
			}
			else
			{
				el = $('<inline>').append($(s).contents());
				$(s).replaceWith(el);
			}


			$(el)[type](attr, value);

			return el;
		},
		// Sort elements and execute callback
		inlineEachNodes: function(callback)
		{
			var range = this.getRange(),
				node = this.getElement(),
				nodes = this.getNodes(),
				collapsed;

			if (range.collapsed || range.startContainer === range.endContainer && node)
			{
				nodes = $(node);
				collapsed = true;
			}

			$.each(nodes, $.proxy(function(i, node)
			{
				if (!collapsed && node.tagName !== 'INLINE')
				{
					var selectionHtml = this.getSelectionText();
					var parentHtml = $(node).parent().text();
					var selected = selectionHtml == parentHtml;

					if (selected && node.parentNode.tagName === 'INLINE' && !$(node.parentNode).hasClass('redactor_editor'))
					{
						node = node.parentNode;
					}
					else return;
				}
				callback.call(this, node);

			}, this ) );
		},
		inlineUnwrapSpan: function()
		{
			var $spans = this.$editor.find('inline');

			$.each($spans, $.proxy(function(i, span)
			{
				var $span = $(span);

				if ($span.attr('class') === undefined && $span.attr('style') === undefined)
				{
					$span.contents().unwrap();
				}

			}, this));
		},
		inlineFormat: function(tag)
		{
			this.selectionSave();

			this.document.execCommand('fontSize', false, 4 );

			var fonts = this.$editor.find('font');
			var last;
			$.each(fonts, function(i, s)
			{
				var el = $('<' + tag + '/>').append($(s).contents());
				$(s).replaceWith(el);
				last = el;
			});

			this.selectionRestore();

			this.sync();
		},
		inlineRemoveFormat: function(tag)
		{
			this.selectionSave();

			var utag = tag.toUpperCase();
			var nodes = this.getNodes();
			var parent = $(this.getParent()).parent();

			$.each(nodes, function(i, s)
			{
				if (s.tagName === utag) this.inlineRemoveFormatReplace(s);
			});

			if (parent && parent[0].tagName === utag) this.inlineRemoveFormatReplace(parent);

			this.selectionRestore();
			this.sync();
		},
		inlineRemoveFormatReplace: function(el)
		{
			$(el).replaceWith($(el).contents());
		},


		// INSERT
		insertHtml: function (html, sync)
		{
			var current = this.getCurrent();
			var parent = current.parentNode;

			this.focusWithSaveScroll();

			this.bufferSet();

			var $html = $('<div>').append($.parseHTML(html));
			html = $html.html();

			html = this.cleanRemoveEmptyTags(html);

			// Update value
			$html = $('<div>').append($.parseHTML(html));
			var currBlock = this.getBlock();

			if ($html.contents().length == 1)
			{
				var htmlTagName = $html.contents()[0].tagName;

				// If the inserted and received text tags match
				if (htmlTagName != 'P' && htmlTagName == currBlock.tagName || htmlTagName == 'PRE')
				{
					//html = $html.html();
					$html = $('<div>').append(html);
				}
			}

			if (this.opts.linebreaks)
			{
				html = html.replace(/<p(.*?)>([\w\W]*?)<\/p>/gi, '$2<br>');
			}

			// add text in a paragraph
			if (!this.opts.linebreaks && $html.contents().length == 1 && $html.contents()[0].nodeType == 3
				&& (this.getRangeSelectedNodes().length > 2 || (!current || current.tagName == 'BODY' && !parent || parent.tagName == 'HTML')))
			{
				html = '<p>' + html + '</p>';
			}

			html = this.setSpansVerifiedHtml(html);

			if ($html.contents().length > 1 && currBlock
			|| $html.contents().is('p, :header, ul, ol, li, div, table, td, blockquote, pre, address, section, header, footer, aside, article'))
			{
				if (this.browser('msie'))
				{
					if (!this.isIe11())
					{
						this.document.selection.createRange().pasteHTML(html);
					}
					else
					{
						this.execPasteFrag(html);
					}
				}
				else
				{
					this.document.execCommand('inserthtml', false, html);
				}
			}
			else this.insertHtmlAdvanced(html, false);

			if (this.selectall)
			{
				this.window.setTimeout($.proxy(function()
				{
					if (!this.opts.linebreaks) this.selectionEnd(this.$editor.contents().last());
					else this.focusEnd();

				}, this), 1);
			}

			this.observeStart();

			// set no editable
			this.setNonEditable();

			if (sync !== false) this.sync();
		},
		insertHtmlAdvanced: function(html, sync)
		{
			html = this.setSpansVerifiedHtml(html);

			var sel = this.getSelection();

			if (sel.getRangeAt && sel.rangeCount)
			{
				var range = sel.getRangeAt(0);
				range.deleteContents();

				var el = this.document.createElement('div');
				el.innerHTML = html;
				var frag = this.document.createDocumentFragment(), node, lastNode;
				while ((node = el.firstChild))
				{
					lastNode = frag.appendChild(node);
				}

				range.insertNode(frag);

				if (lastNode)
				{
					range = range.cloneRange();
					range.setStartAfter(lastNode);
					range.collapse(true);
					sel.removeAllRanges();
					sel.addRange(range);
				}
			}

			if (sync !== false)
			{
				this.sync();
			}

		},
		insertBeforeCursor: function(html)
		{
			html = this.setSpansVerifiedHtml(html);

			var node = $(html);

			var space = document.createElement("span");
			space.innerHTML = "\u200B";

			var range = this.getRange();
			range.insertNode(space);
			range.insertNode(node[0]);
			range.collapse(false);

			var sel = this.getSelection();
			sel.removeAllRanges();
			sel.addRange(range);

			this.sync();
		},
		insertText: function(html)
		{
			var $html = $($.parseHTML(html));

			if ($html.length) html = $html.text();

			this.focusWithSaveScroll();

			if (this.browser('msie'))
			{
				if (!this.isIe11())
				{
					this.document.selection.createRange().pasteHTML(html);
				}
				else
				{
					this.execPasteFrag(html);
				}
			}
			else
			{
				this.document.execCommand('inserthtml', false, html);
			}

			this.sync();
		},
		insertNode: function(node)
		{
			node = node[0] || node;

			if (node.tagName == 'SPAN')
			{
				var replacementTag = 'inline';

			    var outer = node.outerHTML;

			    // Replace opening tag
			    var regex = new RegExp('<' + node.tagName, 'i');
			    var newTag = outer.replace(regex, '<' + replacementTag);

			    // Replace closing tag
			    regex = new RegExp('</' + node.tagName, 'i');
			    newTag = newTag.replace(regex, '</' + replacementTag);
			    node = $(newTag)[0];
			}

			var sel = this.getSelection();
			if (sel.getRangeAt && sel.rangeCount)
			{
				// with delete contents
				range = sel.getRangeAt(0);
				range.deleteContents();
				range.insertNode(node);
				range.setEndAfter(node);
				range.setStartAfter(node);
				sel.removeAllRanges();
				sel.addRange(range);
			}

			return node;
		},
		insertNodeToCaretPositionFromPoint: function(e, node)
		{
			var range;
			var x = e.clientX, y = e.clientY;
			if (this.document.caretPositionFromPoint)
			{
			    var pos = this.document.caretPositionFromPoint(x, y);
			    range = this.getRange();
			    range.setStart(pos.offsetNode, pos.offset);
			    range.collapse(true);
			    range.insertNode(node);
			}
			else if (this.document.caretRangeFromPoint)
			{
			    range = this.document.caretRangeFromPoint(x, y);
			    range.insertNode(node);
			}
			else if (typeof document.body.createTextRange != "undefined")
			{
		        range = this.document.body.createTextRange();
		        range.moveToPoint(x, y);
		        var endRange = range.duplicate();
		        endRange.moveToPoint(x, y);
		        range.setEndPoint("EndToEnd", endRange);
		        range.select();
			}

		},
		insertAfterLastElement: function(element, parent)
		{
			if (typeof(parent) != 'undefined') element = parent;

			if (this.isEndOfElement())
			{
				if (this.opts.linebreaks)
				{
					var contents = $('<div>').append($.trim(this.$editor.html())).contents();
					var last = contents.last()[0];
					if (last.tagName == 'SPAN' && last.innerHTML == '')
					{
						last = contents.prev()[0];
					}

					if (this.outerHtml(last) != this.outerHtml(element))
					{
						return false;
					}
				}
				else
				{
					if (this.$editor.contents().last()[0] !== element)
					{
						return false;
					}
				}

				this.insertingAfterLastElement(element);
			}
		},
		insertingAfterLastElement: function(element)
		{
			this.bufferSet();

			if (this.opts.linebreaks === false)
			{
				var node = $(this.opts.emptyHtml);
				$(element).after(node);
				this.selectionStart(node);
			}
			else
			{
				var node = $('<span id="selection-marker-1">' + this.opts.invisibleSpace + '</span>', this.document)[0];
				$(element).after(node);
				$(node).after(this.opts.invisibleSpace);
				this.selectionRestore();
				this.$editor.find('span#selection-marker-1').removeAttr('id');
			}
		},
		insertLineBreak: function(twice)
		{
			this.selectionSave();

			var br = '<br>';
			if (twice == true)
			{
				br = '<br><br>';
			}

			if (this.browser('mozilla'))
			{
				var span = $('<span>').html(this.opts.invisibleSpace);
				this.$editor.find('#selection-marker-1').before(br).before(span).before(this.opts.invisibleSpace);

				this.setCaretAfter(span[0]);
				span.remove();

				this.selectionRemoveMarkers();
			}
			else
			{
				var parent = this.getParent();
				if (parent && parent.tagName === 'A')
				{
					var offset = this.getCaretOffset(parent);

					var text = $.trim($(parent).text()).replace(/\n\r\n/g, '');
					var len = text.length;

					if (offset == len)
					{
						this.selectionRemoveMarkers();

						var node = $('<span id="selection-marker-1">' + this.opts.invisibleSpace + '</span>', this.document)[0];
						$(parent).after(node);
						$(node).before(br + (this.browser('webkit') ? this.opts.invisibleSpace : ''));
						this.selectionRestore();

						return true;
					}

				}

				this.$editor.find('#selection-marker-1').before(br + (this.browser('webkit') ? this.opts.invisibleSpace : ''));
				this.selectionRestore();
			}
		},
		insertDoubleLineBreak: function()
		{
			this.insertLineBreak(true);
		},
		replaceLineBreak: function(element)
		{
			var node = $('<br>' + this.opts.invisibleSpace);
			$(element).replaceWith(node);
			this.selectionStart(node);
		},

		// PASTE
		pasteClean: function(html)
		{
			html = this.callback('pasteBefore', false, html);

			// ie10 fix paste links
			if (this.browser('msie'))
			{
				var tmp = $.trim(html);
				if (tmp.search(/^<a(.*?)>(.*?)<\/a>$/i) == 0)
				{
					html = html.replace(/^<a(.*?)>(.*?)<\/a>$/i, "$2");
				}
			}

			if (this.opts.pastePlainText)
			{
				var tmp = this.document.createElement('div');

				html = html.replace(/<br>|<\/H[1-6]>|<\/p>|<\/div>/gi, '\n');

				tmp.innerHTML = html;
				html = tmp.textContent || tmp.innerText;

				html = $.trim(html);
				html = html.replace('\n', '<br>');
				html = this.cleanParagraphy(html);

				this.pasteInsert(html);
				return false;
			}

			// clean up table
			var tablePaste = false;
			if (this.currentOrParentIs('TD'))
			{
				tablePaste = true;
				var blocksElems = this.opts.blockLevelElements;
				blocksElems.push('tr');
				blocksElems.push('table');
				$.each(blocksElems, function(i,s)
				{
					html = html.replace(new RegExp('<' + s + '(.*?)>', 'gi'), '');
					html = html.replace(new RegExp('</' + s + '>', 'gi'), '<br>');
				});
			}

			// clean up pre
			if (this.currentOrParentIs('PRE'))
			{
				html = this.pastePre(html);
				this.pasteInsert(html);
				return true;
			}

			// ms words shapes
			html = html.replace(/<img(.*?)v:shapes=(.*?)>/gi, '');

			// ms word list
			html = html.replace(/<p(.*?)class="MsoListParagraphCxSpFirst"([\w\W]*?)<\/p>/gi, '<ul><li$2</li>');
			html = html.replace(/<p(.*?)class="MsoListParagraphCxSpMiddle"([\w\W]*?)<\/p>/gi, '<li$2</li>');
			html = html.replace(/<p(.*?)class="MsoListParagraphCxSpLast"([\w\W]*?)<\/p>/gi, '<li$2</li></ul>');
			// one line
			html = html.replace(/<p(.*?)class="MsoListParagraph"([\w\W]*?)<\/p>/gi, '<ul><li$2</li></ul>');
			// remove ms word's bullet
			html = html.replace(/·/g, '');

			// remove comments and php tags
			html = html.replace(/<!--[\s\S]*?-->|<\?(?:php)?[\s\S]*?\?>/gi, '');

			// remove nbsp
			if (this.opts.cleanSpaces === true)
			{
				html = html.replace(/(&nbsp;){2,}/gi, '&nbsp;');
				html = html.replace(/&nbsp;/gi, ' ');
			}

			// remove google docs marker
			html = html.replace(/<b\sid="internal-source-marker(.*?)">([\w\W]*?)<\/b>/gi, "$2");
			html = html.replace(/<b(.*?)id="docs-internal-guid(.*?)">([\w\W]*?)<\/b>/gi, "$3");


	 		html = html.replace(/<span[^>]*(font-style: italic; font-weight: bold|font-weight: bold; font-style: italic)[^>]*>/gi, '<span style="font-weight: bold;"><span style="font-style: italic;">');
	 		html = html.replace(/<span[^>]*font-style: italic[^>]*>/gi, '<span style="font-style: italic;">');
			html = html.replace(/<span[^>]*font-weight: bold[^>]*>/gi, '<span style="font-weight: bold;">');
			html = html.replace(/<span[^>]*text-decoration: underline[^>]*>/gi, '<span style="text-decoration: underline;">');

			// strip tags
			//html = this.cleanStripTags(html);



			// prevert
			html = html.replace(/<td>\u200b*<\/td>/gi, '[td]');
			html = html.replace(/<td>&nbsp;<\/td>/gi, '[td]');
			html = html.replace(/<td><br><\/td>/gi, '[td]');
			html = html.replace(/<td(.*?)colspan="(.*?)"(.*?)>([\w\W]*?)<\/td>/gi, '[td colspan="$2"]$4[/td]');
			html = html.replace(/<td(.*?)rowspan="(.*?)"(.*?)>([\w\W]*?)<\/td>/gi, '[td rowspan="$2"]$4[/td]');
			html = html.replace(/<a(.*?)href="(.*?)"(.*?)>([\w\W]*?)<\/a>/gi, '[a href="$2"]$4[/a]');
			html = html.replace(/<iframe(.*?)>([\w\W]*?)<\/iframe>/gi, '[iframe$1]$2[/iframe]');
			html = html.replace(/<video(.*?)>([\w\W]*?)<\/video>/gi, '[video$1]$2[/video]');
			html = html.replace(/<audio(.*?)>([\w\W]*?)<\/audio>/gi, '[audio$1]$2[/audio]');
			html = html.replace(/<embed(.*?)>([\w\W]*?)<\/embed>/gi, '[embed$1]$2[/embed]');
			html = html.replace(/<object(.*?)>([\w\W]*?)<\/object>/gi, '[object$1]$2[/object]');
			html = html.replace(/<param(.*?)>/gi, '[param$1]');

			html = html.replace(/<img(.*?)>/gi, '[img$1]');

			// remove classes
			html = html.replace(/ class="(.*?)"/gi, '');

			// remove all attributes
			html = html.replace(/<(\w+)([\w\W]*?)>/gi, '<$1>');

			// remove empty
			if (this.opts.linebreaks)
			{
				// prevent double linebreaks when an empty line in RTF has bold or underlined formatting associated with it
				html = html.replace(/<strong><\/strong>/gi, '');
				html = html.replace(/<u><\/u>/gi, '');

				if (this.opts.cleanFontTag)
				{
					html = html.replace(/<font(.*?)>([\w\W]*?)<\/font>/gi, '$2');
				}

				html = html.replace(/<[^\/>][^>]*>(\s*|\t*|\n*|&nbsp;|<br>)<\/[^>]+>/gi, '<br>');
			}
			else
			{
				html = html.replace(/<[^\/>][^>]*>(\s*|\t*|\n*|&nbsp;|<br>)<\/[^>]+>/gi, '');
			}

			html = html.replace(/<div>\s*?\t*?\n*?(<ul>|<ol>|<p>)/gi, '$1');

			// revert
			html = html.replace(/\[td colspan="(.*?)"\]([\w\W]*?)\[\/td\]/gi, '<td colspan="$1">$2</td>');
			html = html.replace(/\[td rowspan="(.*?)"\]([\w\W]*?)\[\/td\]/gi, '<td rowspan="$1">$2</td>');
			html = html.replace(/\[td\]/gi, '<td>&nbsp;</td>');
			html = html.replace(/\[a href="(.*?)"\]([\w\W]*?)\[\/a\]/gi, '<a href="$1">$2</a>');
			html = html.replace(/\[iframe(.*?)\]([\w\W]*?)\[\/iframe\]/gi, '<iframe$1>$2</iframe>');
			html = html.replace(/\[video(.*?)\]([\w\W]*?)\[\/video\]/gi, '<video$1>$2</video>');
			html = html.replace(/\[audio(.*?)\]([\w\W]*?)\[\/audio\]/gi, '<audio$1>$2</audio>');
			html = html.replace(/\[embed(.*?)\]([\w\W]*?)\[\/embed\]/gi, '<embed$1>$2</embed>');
			html = html.replace(/\[object(.*?)\]([\w\W]*?)\[\/object\]/gi, '<object$1>$2</object>');
			html = html.replace(/\[param(.*?)\]/gi, '<param$1>');
			html = html.replace(/\[img(.*?)\]/gi, '<img$1>');

			// convert div to p
			if (this.opts.convertDivs)
			{
				html = html.replace(/<div(.*?)>([\w\W]*?)<\/div>/gi, '<p>$2</p>');
				html = html.replace(/<\/div><p>/gi, '<p>');
				html = html.replace(/<\/p><\/div>/gi, '</p>');
				html = html.replace(/<p><\/p>/gi, '<br />');
			}
			else
			{
				html = html.replace(/<div><\/div>/gi, '<br />');
			}

			// strip tags
			html = this.cleanStripTags(html);

			if (this.currentOrParentIs('LI'))
			{
				html = html.replace(/<p>([\w\W]*?)<\/p>/gi, '$1<br>');
			}
			else if (tablePaste === false)
			{
				html = this.cleanParagraphy(html);
			}

			// remove span
			html = html.replace(/<span(.*?)>([\w\W]*?)<\/span>/gi, '$2');

			// remove empty
			html = html.replace(/<img>/gi, '');
			html = html.replace(/<[^\/>][^>][^img|param|source|td][^<]*>(\s*|\t*|\n*| |<br>)<\/[^>]+>/gi, '');

			html = html.replace(/\n{3,}/gi, '\n');

			// remove dirty p
			html = html.replace(/<p><p>/gi, '<p>');
			html = html.replace(/<\/p><\/p>/gi, '</p>');

			html = html.replace(/<li>(\s*|\t*|\n*)<p>/gi, '<li>');
			html = html.replace(/<\/p>(\s*|\t*|\n*)<\/li>/gi, '</li>');

			if (this.opts.linebreaks === true)
			{
				html = html.replace(/<p(.*?)>([\w\W]*?)<\/p>/gi, '$2<br>');
			}

			// remove empty finally
			html = html.replace(/<[^\/>][^>][^img|param|source|td][^<]*>(\s*|\t*|\n*| |<br>)<\/[^>]+>/gi, '');

			// remove safari local images
			html = html.replace(/<img src="webkit-fake-url\:\/\/(.*?)"(.*?)>/gi, '');

			// remove p in td
			html = html.replace(/<td(.*?)>(\s*|\t*|\n*)<p>([\w\W]*?)<\/p>(\s*|\t*|\n*)<\/td>/gi, '<td$1>$3</td>');

			// remove divs
			if (this.opts.convertDivs)
			{
				html = html.replace(/<div(.*?)>([\w\W]*?)<\/div>/gi, '$2');
				html = html.replace(/<div(.*?)>([\w\W]*?)<\/div>/gi, '$2');
			}

			// FF specific
			this.pasteClipboardMozilla = false;
			if (this.browser('mozilla'))
			{
				if (this.opts.clipboardUpload)
				{
					var matches = html.match(/<img src="data:image(.*?)"(.*?)>/gi);
					if (matches !== null)
					{
						this.pasteClipboardMozilla = matches;
						for (k in matches)
						{
							var img = matches[k].replace('<img', '<img data-mozilla-paste-image="' + k + '" ');
							html = html.replace(matches[k], img);
						}
					}
				}

				// FF fix
				while (/<br>$/gi.test(html))
				{
					html = html.replace(/<br>$/gi, '');
				}
			}

			// bullets again
			html = html.replace(/<p>•([\w\W]*?)<\/p>/gi, '<li>$1</li>');

			// ie inserts a blank font tags when pasting
			if (this.browser('msie'))
			{
				while (/<font>([\w\W]*?)<\/font>/gi.test(html))
				{
					html = html.replace(/<font>([\w\W]*?)<\/font>/gi, '$1');
				}
			}

			// remove table paragraphs
			if (tablePaste === false)
			{
				html = html.replace(/<td(.*?)>([\w\W]*?)<p(.*?)>([\w\W]*?)<\/td>/gi, '<td$1>$2$4</td>');
				html = html.replace(/<td(.*?)>([\w\W]*?)<\/p>([\w\W]*?)<\/td>/gi, '<td$1>$2$3</td>');
				html = html.replace(/<td(.*?)>([\w\W]*?)<p(.*?)>([\w\W]*?)<\/td>/gi, '<td$1>$2$4</td>');
				html = html.replace(/<td(.*?)>([\w\W]*?)<\/p>([\w\W]*?)<\/td>/gi, '<td$1>$2$3</td>');
			}

			// ms word break lines
			html = html.replace(/\n/g, ' ');

			// ms word lists break lines
			html = html.replace(/<p>\n?<li>/gi, '<li>');

			this.pasteInsert(html);

		},
		pastePre: function(s)
		{
			s = s.replace(/<br>|<\/H[1-6]>|<\/p>|<\/div>/gi, '\n');

			var tmp = this.document.createElement('div');
			tmp.innerHTML = s;
			return this.cleanEncodeEntities(tmp.textContent || tmp.innerText);
		},
		pasteInsert: function(html)
		{
			html = this.callback('pasteAfter', false, html);

			if (this.selectall)
			{
				this.$editor.html(html);
				this.selectionRemove();
				this.focusEnd();
				this.sync();
			}
			else
			{
				this.insertHtml(html);
			}

			this.selectall = false;

			setTimeout($.proxy(function()
			{
				this.rtePaste = false;

				// FF specific
				if (this.browser('mozilla'))
				{
					this.$editor.find('p:empty').remove()
				}
				if (this.pasteClipboardMozilla !== false)
				{
					this.pasteClipboardUploadMozilla();
				}

			}, this), 100);

			if (this.opts.autoresize && this.fullscreen !== true)
			{
				$(this.document.body).scrollTop(this.saveScroll);
			}
			else
			{
				this.$editor.scrollTop(this.saveScroll);
			}
		},
		pasteClipboardAppendFields: function(postData)
		{
			// append hidden fields
			if (this.opts.uploadFields !== false && typeof this.opts.uploadFields === 'object')
			{
				$.each(this.opts.uploadFields, $.proxy(function(k, v)
				{
					if (v != null && v.toString().indexOf('#') === 0) v = $(v).val();
					postData[k] = v;

				}, this));
			}

			return postData;
		},
		pasteClipboardUploadMozilla: function()
		{
			var imgs = this.$editor.find('img[data-mozilla-paste-image]');
			$.each(imgs, $.proxy(function(i,s)
			{
				var $s = $(s);
				var arr = s.src.split(",");
				var postData = {
					'contentType': arr[0].split(";")[0].split(":")[1],
					'data': arr[1] // raw base64
				};

				// append hidden fields
				postData = this.pasteClipboardAppendFields(postData);

				$.post(this.opts.clipboardUploadUrl, postData,
				$.proxy(function(data)
				{
					var json = (typeof data === 'string' ? $.parseJSON(data) : data);
		        	$s.attr('src', json.filelink);
		        	$s.removeAttr('data-mozilla-paste-image');

		        	this.sync();

					// upload callback
					this.callback('imageUpload', $s, json);

				}, this));

			}, this));
		},
		pasteClipboardUpload: function(e)
		{
	        var result = e.target.result;
			var arr = result.split(",");
			var postData = {
				'contentType': arr[0].split(";")[0].split(":")[1],
				'data': arr[1] // raw base64
			};


			if (this.opts.clipboardUpload)
			{
				// append hidden fields
				postData = this.pasteClipboardAppendFields(postData);

				$.post(this.opts.clipboardUploadUrl, postData,
				$.proxy(function(data)
				{
					var json = (typeof data === 'string' ? $.parseJSON(data) : data);

					var html = '<img src="' + json.filelink + '" id="clipboard-image-marker" />';
					this.execCommand('inserthtml', html, false);

					var image = $(this.$editor.find('img#clipboard-image-marker'));

					if (image.length) image.removeAttr('id');
					else image = false;

					this.sync();

					// upload callback
					if (image)
					{
						this.callback('imageUpload', image, json);
					}


				}, this));
			}
			else
			{
	        	this.insertHtml('<img src="' + result + '" />');
        	}
		},

		// BUFFER
		bufferSet: function(selectionSave)
		{
			if (selectionSave !== false)
			{
				this.selectionSave();
			}

			this.opts.buffer.push(this.$editor.html());

			if (selectionSave !== false)
			{
				this.selectionRemoveMarkers('buffer');
			}

		},
		bufferUndo: function()
		{
			if (this.opts.buffer.length === 0)
			{
				this.focusWithSaveScroll();
				return;
			}

			// rebuffer
			this.selectionSave();
			this.opts.rebuffer.push(this.$editor.html());
			this.selectionRestore(false, true);

			this.$editor.html(this.opts.buffer.pop());

			this.selectionRestore();
			setTimeout($.proxy(this.observeStart, this), 100);
		},
		bufferRedo: function()
		{
			if (this.opts.rebuffer.length === 0)
			{
				this.focusWithSaveScroll();
				return false;
			}

			// buffer
			this.selectionSave();
			this.opts.buffer.push(this.$editor.html());
			this.selectionRestore(false, true);

			this.$editor.html(this.opts.rebuffer.pop());
			this.selectionRestore(true);
			setTimeout($.proxy(this.observeStart, this), 4);
		},

		// OBSERVE
		observeStart: function()
		{
			this.observeImages();

			if (this.opts.observeLinks) this.observeLinks();
		},
		observeLinks: function()
		{
			this.$editor.find('a').on('click', $.proxy(this.linkObserver, this));

			this.$editor.on('click.redactor', $.proxy(function(e)
			{
				this.linkObserverTooltipClose(e);

			}, this));

			$(document).on('click.redactor', $.proxy(function(e)
			{
				this.linkObserverTooltipClose(e);

			}, this));
		},
		observeImages: function()
		{
			if (this.opts.observeImages === false) return false;

			this.$editor.find('img').each($.proxy(function(i, elem)
			{
				if (this.browser('msie')) $(elem).attr('unselectable', 'on');

				var parent = $(elem).parent();
				if (!parent.hasClass('royalSlider') && !parent.hasClass('fotorama'))
				{
					this.imageResize(elem);
				}

			}, this));

			// royalSlider and fotorama
			this.$editor.find('.fotorama, .royalSlider').on('click', $.proxy(this.editGallery, this));

		},
		linkObserver: function(e)
		{
			var $link = $(e.target);

			var parent = $(e.target).parent();
			if (parent.hasClass('royalSlider') || parent.hasClass('fotorama'))
			{
				return;
			}

			if ($link.size() == 0 || $link[0].tagName !== 'A') return;

			var pos = $link.offset();
			if (this.opts.iframe)
			{
				var posFrame = this.$frame.offset();
				pos.top = posFrame.top + (pos.top - $(this.document).scrollTop());
				pos.left += posFrame.left;
			}

			var tooltip = $('<span class="redactor-link-tooltip"></span>');

			var href = $link.attr('href');
			if (href === undefined)
			{
				href = '';
			}

			if (href.length > 24) href = href.substring(0, 24) + '...';

			var aLink = $('<a href="' + $link.attr('href') + '" target="_blank">' + href + '</a>').on('click', $.proxy(function(e)
			{
				this.linkObserverTooltipClose(false);
			}, this));

			var aEdit = $('<a href="#">' + this.opts.curLang.edit + '</a>').on('click', $.proxy(function(e)
			{
				e.preventDefault();
				this.linkShow();
				this.linkObserverTooltipClose(false);

			}, this));

			var aUnlink = $('<a href="#">' + this.opts.curLang.unlink + '</a>').on('click', $.proxy(function(e)
			{
				e.preventDefault();
				this.execCommand('unlink');
				this.linkObserverTooltipClose(false);

			}, this));


			tooltip.append(aLink);
			tooltip.append(' | ');
			tooltip.append(aEdit);
			tooltip.append(' | ');
			tooltip.append(aUnlink);
			tooltip.css({
				top: (pos.top + 20) + 'px',
				left: pos.left + 'px'
			});

			$('.redactor-link-tooltip').remove();
			$('body').append(tooltip);
		},
		linkObserverTooltipClose: function(e)
		{
			if (e !== false && e.target.tagName == 'A') return false;
			$('.redactor-link-tooltip').remove();
		},

		// SELECTION
		getSelection: function()
		{
			if (!this.opts.rangy) return this.document.getSelection();
			else // rangy
			{
				if (!this.opts.iframe) return rangy.getSelection();
				else return rangy.getSelection(this.$frame[0]);
			}
		},
		getRange: function()
		{
			if (!this.opts.rangy)
			{
				if (this.document.getSelection)
				{
					var sel = this.getSelection();
					if (sel.getRangeAt && sel.rangeCount) return sel.getRangeAt(0);
				}

				return this.document.createRange();
			}
			else // rangy
			{
				if (!this.opts.iframe) return rangy.createRange();
				else return rangy.createRange(this.iframeDoc());
			}
		},
		selectionElement: function(node)
		{
			this.setCaret(node);
		},
		selectionStart: function(node)
		{
			this.selectionSet(node[0] || node, 0, null, 0);
		},
		selectionEnd: function(node)
		{
			this.selectionSet(node[0] || node, 1, null, 1);
		},
		selectionSet: function(orgn, orgo, focn, foco)
		{
			if (focn == null) focn = orgn;
			if (foco == null) foco = orgo;

			var sel = this.getSelection();
			if (!sel) return;

			if (orgn.tagName == 'P' && orgn.innerHTML == '')
			{
				orgn.innerHTML = this.opts.invisibleSpace;
			}

			if (orgn.tagName == 'BR' && this.opts.linebreaks === false)
			{
				var par = $(this.opts.emptyHtml)[0];
				$(orgn).replaceWith(par);
				orgn = par;
				focn = orgn;
			}

			var range = this.getRange();
			range.setStart(orgn, orgo);
			range.setEnd(focn, foco );

			try {
				sel.removeAllRanges();
			} catch (e) {}

			sel.addRange(range);
		},
		selectionWrap: function(tag)
		{
			tag = tag.toLowerCase();

			var block = this.getBlock();
			if (block)
			{
				var wrapper = this.formatChangeTag(block, tag);
				this.sync();
				return wrapper;
			}

			var sel = this.getSelection();
			var range = sel.getRangeAt(0);
			var wrapper = document.createElement(tag);
			wrapper.appendChild(range.extractContents());
			range.insertNode(wrapper);

			this.selectionElement(wrapper);

			return wrapper;
		},
		selectionAll: function()
		{
			var range = this.getRange();
			range.selectNodeContents(this.$editor[0]);

			var sel = this.getSelection();
			sel.removeAllRanges();
			sel.addRange(range);
		},
		selectionRemove: function()
		{
			this.getSelection().removeAllRanges();
		},
		getCaretOffset: function (element)
		{
			var caretOffset = 0;

			var range = this.getRange();
			var preCaretRange = range.cloneRange();
			preCaretRange.selectNodeContents(element);
			preCaretRange.setEnd(range.endContainer, range.endOffset);
			caretOffset = $.trim(preCaretRange.toString()).length;

			return caretOffset;
		},
		getCaretOffsetRange: function()
		{
			return new Range(this.getSelection().getRangeAt(0));
		},
		setCaret: function (el, start, end)
		{
			if (typeof end === 'undefined') end = start;
			el = el[0] || el;

			var range = this.getRange();
			range.selectNodeContents(el);

			var textNodes = this.getTextNodesIn(el);
			var foundStart = false;
			var charCount = 0, endCharCount;

			if (textNodes.length == 1 && start)
			{
				range.setStart(textNodes[0], start);
				range.setEnd(textNodes[0], end);
			}
			else
			{
				for (var i = 0, textNode; textNode = textNodes[i++];)
				{
					endCharCount = charCount + textNode.length;
					if (!foundStart && start >= charCount && (start < endCharCount || (start == endCharCount && i < textNodes.length)))
					{
						range.setStart(textNode, start - charCount);
						foundStart = true;
					}

					if (foundStart && end <= endCharCount)
					{
						range.setEnd( textNode, end - charCount );
						break;
					}

					charCount = endCharCount;
				}
			}

			var sel = this.getSelection();
			sel.removeAllRanges();
			sel.addRange( range );
		},
		setCaretAfter: function(node)
		{
			this.$editor.focus();

			node = node[0] || node;

			var range = this.document.createRange()

			var start = 1;
			var end = -1;

			range.setStart(node, start)
			range.setEnd(node, end + 2)


			var selection = this.window.getSelection()
			var cursorRange = this.document.createRange()

			var emptyElement = this.document.createTextNode('\u200B')
			$(node).after(emptyElement)

			cursorRange.setStartAfter(emptyElement)

			selection.removeAllRanges()
			selection.addRange(cursorRange)
			$(emptyElement).remove();
		},
		getTextNodesIn: function (node)
		{
			var textNodes = [];

			if (node.nodeType == 3) textNodes.push(node);
			else
			{
				var children = node.childNodes;
				for (var i = 0, len = children.length; i < len; ++i)
				{
					textNodes.push.apply(textNodes, this.getTextNodesIn(children[i]));
				}
			}

			return textNodes;
		},

		// GET ELEMENTS
		getCurrent: function()
		{
			var el = false;
			var sel = this.getSelection();

			if (sel && sel.rangeCount > 0)
			{
				el = sel.getRangeAt(0).startContainer;
				//el = sel.getRangeAt(0).commonAncestorContainer;
			}

			return this.isParentRedactor(el);
		},
		getParent: function(elem)
		{
			elem = elem || this.getCurrent();
			if (elem) return this.isParentRedactor( $( elem ).parent()[0] );
			else return false;
		},
		getBlock: function(node)
		{
			if (typeof node === 'undefined') node = this.getCurrent();

			while (node)
			{
				if (this.nodeTestBlocks(node))
				{
					if ($(node).hasClass('redactor_editor')) return false;
					return node;
				}

				node = node.parentNode;
			}

			return false;
		},
		getBlocks: function(nodes)
		{
			var newnodes = [];
			if (typeof nodes == 'undefined')
			{
				var range = this.getRange();
				if (range && range.collapsed === true) return [this.getBlock()];
				var nodes = this.getNodes(range);
			}

			$.each(nodes, $.proxy(function(i,node)
			{
				if (this.opts.iframe === false && $(node).parents('div.redactor_editor').size() == 0) return false;
				if (this.nodeTestBlocks(node)) newnodes.push(node);

			}, this));

			if (newnodes.length === 0) newnodes = [this.getBlock()];

			return newnodes;
		},
		isInlineNode: function(node)
		{
			if (node.nodeType != 1) return false;

			return !this.rTestBlock.test(node.nodeName);
		},
		nodeTestBlocks: function(node)
		{
			return node.nodeType == 1 && this.rTestBlock.test(node.nodeName);
		},
		tagTestBlock: function(tag)
		{
			return this.rTestBlock.test(tag);
		},
		getNodes: function(range, tag)
		{
			if (typeof range == 'undefined' || range == false) var range = this.getRange();
			if (range && range.collapsed === true)
			{
				if (typeof tag === 'undefined' && this.tagTestBlock(tag))
				{
					var block = this.getBlock();
					if (block.tagName == tag) return [block];
					else return [];
				}
				else
				{
					return [this.getCurrent()];
				}
			}

			var nodes = [], finalnodes = [];

			var sel = this.document.getSelection();
			if (!sel.isCollapsed) nodes = this.getRangeSelectedNodes(sel.getRangeAt(0));

			$.each(nodes, $.proxy(function(i,node)
			{
				if (this.opts.iframe === false && $(node).parents('div.redactor_editor').size() == 0) return false;

				if (typeof tag === 'undefined')
				{
					if ($.trim(node.textContent) != '')
					{
						finalnodes.push(node);
					}
				}
				else if (node.tagName == tag)
				{
					finalnodes.push(node);
				}

			}, this));

			if (finalnodes.length == 0)
			{
				if (typeof tag === 'undefined' && this.tagTestBlock(tag))
				{
					var block = this.getBlock();
					if (block.tagName == tag) return finalnodes.push(block);
					else return [];
				}
				else
				{
					finalnodes.push(this.getCurrent());
				}
			}

			// last element filtering
			var last = finalnodes[finalnodes.length-1];
			if (this.nodeTestBlocks(last))
			{
				finalnodes = finalnodes.slice(0, -1);
			}

			return finalnodes;
		},
		getElement: function(node)
		{
			if (!node) node = this.getCurrent();
			while (node)
			{
				if (node.nodeType == 1)
				{
					if ($(node).hasClass('redactor_editor')) return false;
					return node;
				}

				node = node.parentNode;
			}

			return false;
		},
		getRangeSelectedNodes: function(range)
		{
			range = range || this.getRange();
			var node = range.startContainer;
			var endNode = range.endContainer;

			if (node == endNode) return [node];

			var rangeNodes = [];
			while (node && node != endNode)
			{
				rangeNodes.push(node = this.nextNode(node));
			}

			node = range.startContainer;
			while (node && node != range.commonAncestorContainer)
			{
				rangeNodes.unshift(node);
				node = node.parentNode;
			}

			return rangeNodes;
		},
		nextNode: function(node)
		{
			if (node.hasChildNodes()) return node.firstChild;
			else
			{
				while (node && !node.nextSibling)
				{
					node = node.parentNode;
				}

				if (!node) return null;
				return node.nextSibling;
			}
		},

		// GET SELECTION HTML OR TEXT
		getSelectionText: function()
		{
			return this.getSelection().toString();
		},
		getSelectionHtml: function()
		{
			var html = '';

			var sel = this.getSelection();
			if (sel.rangeCount)
			{
				var container = this.document.createElement( "div" );
				var len = sel.rangeCount;
				for (var i = 0; i < len; ++i)
				{
					container.appendChild(sel.getRangeAt(i).cloneContents());
				}

				html = container.innerHTML;
			}

			return this.syncClean(html);
		},

		// SAVE & RESTORE
		selectionSave: function()
		{
			if (!this.isFocused())
			{
				this.focusWithSaveScroll();
			}

			if (!this.opts.rangy)
			{
				this.selectionCreateMarker(this.getRange());
			}
			// rangy
			else
			{
				this.savedSel = rangy.saveSelection();
			}
		},
		selectionCreateMarker: function(range, remove)
		{
			if (!range) return;

			var node1 = $('<span id="selection-marker-1" class="redactor-selection-marker">' + this.opts.invisibleSpace + '</span>', this.document)[0];
			var node2 = $('<span id="selection-marker-2" class="redactor-selection-marker">' + this.opts.invisibleSpace + '</span>', this.document)[0];

			if (range.collapsed === true)
			{
				this.selectionSetMarker(range, node1, true);
			}
			else
			{
				this.selectionSetMarker(range, node1, true);
				this.selectionSetMarker(range, node2, false);
			}

			this.savedSel = this.$editor.html();

			this.selectionRestore(false, false);
		},
		selectionSetMarker: function(range, node, type)
		{
			var boundaryRange = range.cloneRange();

			try {
				boundaryRange.collapse(type);
				boundaryRange.insertNode(node);
				boundaryRange.detach();
			}
			catch (e)
			{
				var html = this.opts.emptyHtml;
				if (this.opts.linebreaks) html = '<br>';

				this.$editor.prepend(html);
				this.focus();
			}
		},
		selectionRestore: function(replace, remove)
		{
			if (!this.opts.rangy)
			{
				if (replace === true && this.savedSel)
				{
					this.$editor.html(this.savedSel);
				}

				var node1 = this.$editor.find('span#selection-marker-1');
				var node2 = this.$editor.find('span#selection-marker-2');

				if (this.browser('mozilla'))
				{
					this.$editor.focus();
				}
				else if (!this.isFocused())
				{
					this.focusWithSaveScroll();
				}

				if (node1.length != 0 && node2.length != 0)
				{

					this.selectionSet(node1[0], 0, node2[0], 0);
				}
				else if (node1.length != 0)
				{
					this.selectionSet(node1[0], 0, null, 0);
				}

				if (remove !== false)
				{
					this.selectionRemoveMarkers();
					this.savedSel = false;
				}
			}
			// rangy
			else
			{
				rangy.restoreSelection(this.savedSel);
			}
		},
		selectionRemoveMarkers: function(type)
		{
			if (!this.opts.rangy)
			{
				$.each(this.$editor.find('span.redactor-selection-marker'), function()
				{
					var html = $.trim($(this).html().replace(/[^\u0000-\u1C7F]/g, ''));
					if (html == '')
					{
						$(this).remove();
					}
					else
					{
						$(this).removeAttr('class').removeAttr('id');
					}
				});
			}
			// rangy
			else
			{
				rangy.removeMarkers(this.savedSel);
			}
		},

		// TABLE
		tableShow: function()
		{
			this.selectionSave();

			this.modalInit(this.opts.curLang.table, this.opts.modal_table, 300, $.proxy(function()
			{
				$('#redactor_insert_table_btn').click($.proxy(this.tableInsert, this));

				setTimeout(function()
				{
					$('#redactor_table_rows').focus();

				}, 200);

			}, this));
		},
		tableInsert: function()
		{
			this.bufferSet(false);

			var rows = $('#redactor_table_rows').val(),
				columns = $('#redactor_table_columns').val(),
				$table_box = $('<div></div>'),
				tableId = Math.floor(Math.random() * 99999),
				$table = $('<table id="table' + tableId + '"><tbody></tbody></table>'),
				i, $row, z, $column;

			for (i = 0; i < rows; i++)
			{
				$row = $('<tr></tr>');

				for (z = 0; z < columns; z++)
				{
					$column = $('<td>' + this.opts.invisibleSpace + '</td>');

					// set the focus to the first td
					if (i === 0 && z === 0)
					{
						$column.append('<span id="selection-marker-1">' + this.opts.invisibleSpace + '</span>');
					}

					$($row).append($column);
				}

				$table.append($row);
			}

			$table_box.append($table);
			var html = $table_box.html();

			if (this.opts.linebreaks === false && this.browser('mozilla'))
			{
				html += '<p>' + this.opts.invisibleSpace + '</p>';
			}

			this.modalClose();
			this.selectionRestore();

			var current = this.getBlock() || this.getCurrent();

			if (current && current.tagName != 'BODY')
			{
				if (current.tagName == 'LI')
				{
					var current = $(current).closest('ul, ol');
				}

				$(current).after(html)
			}
			else
			{
				this.insertHtmlAdvanced(html, false);
			}

			this.selectionRestore();

			var table = this.$editor.find('#table' + tableId);
			this.buttonActiveObserver();

			table.find('span#selection-marker-1, inline#selection-marker-1').remove();
			table.removeAttr('id');

			this.sync();
		},
		tableDeleteTable: function()
		{
			var $table = $(this.getParent()).closest('table');
			if (!this.isParentRedactor($table)) return false;
			if ($table.size() == 0) return false;

			this.bufferSet();

			$table.remove();
			this.sync();
		},
		tableDeleteRow: function()
		{
			var parent = this.getParent();
			var $table = $(parent).closest('table');


			if (!this.isParentRedactor($table)) return false;
			if ($table.size() == 0) return false;

			this.bufferSet();

			var $current_tr = $(parent).closest('tr');
			var $focus_tr = $current_tr.prev().length ? $current_tr.prev() : $current_tr.next();
			if ($focus_tr.length)
			{
				var $focus_td = $focus_tr.children('td' ).first();
				if ($focus_td.length)
				{
					$focus_td.prepend('<span id="selection-marker-1">' + this.opts.invisibleSpace + '</span>');
				}
			}

			$current_tr.remove();
			this.selectionRestore();
			$table.find('span#selection-marker-1').remove();
			this.sync();
		},
		tableDeleteColumn: function()
		{
			var parent = this.getParent();
			var $table = $(parent).closest('table');

			if (!this.isParentRedactor($table)) return false;
			if ($table.size() == 0) return false;

			this.bufferSet();

			var $current_td = $(parent).closest('td');
			if (!($current_td.is('td')))
			{
				$current_td = $current_td.closest('td');
			}

			var index = $current_td.get(0).cellIndex;

			// Set the focus correctly
			$table.find('tr').each($.proxy(function(i, elem)
			{
				var focusIndex = index - 1 < 0 ? index + 1 : index - 1;
				if (i === 0)
				{
					$(elem).find('td').eq(focusIndex).prepend('<span id="selection-marker-1">' + this.opts.invisibleSpace + '</span>');
				}

				$(elem).find('td').eq(index).remove();

			}, this));

			this.selectionRestore();
			$table.find('span#selection-marker-1').remove();
			this.sync();
		},
		tableAddHead: function()
		{
			var $table = $(this.getParent()).closest('table');
			if (!this.isParentRedactor($table)) return false;
			if ($table.size() == 0) return false;

			this.bufferSet();

			if ($table.find('thead').size() !== 0) this.tableDeleteHead();
			else
			{
				var tr = $table.find('tr').first().clone();
				tr.find('td').html(this.opts.invisibleSpace);
				$thead = $('<thead></thead>');
				$thead.append(tr);
				$table.prepend($thead);

				this.sync();
			}
		},
		tableDeleteHead: function()
		{
			var $table = $(this.getParent()).closest('table');
			if (!this.isParentRedactor($table)) return false;
			var $thead = $table.find('thead');

			if ($thead.size() == 0) return false;

			this.bufferSet();

			$thead.remove();
			this.sync();
		},
		tableAddRowAbove: function()
		{
			this.tableAddRow('before');
		},
		tableAddRowBelow: function()
		{
			this.tableAddRow('after');
		},
		tableAddColumnLeft: function()
		{
			this.tableAddColumn('before');
		},
		tableAddColumnRight: function()
		{
			this.tableAddColumn('after');
		},
		tableAddRow: function(type)
		{
			var $table = $(this.getParent()).closest('table');
			if (!this.isParentRedactor($table)) return false;
			if ($table.size() == 0) return false;

			this.bufferSet();

			var $current_tr = $(this.getParent()).closest('tr');
			var new_tr = $current_tr.clone();
			new_tr.find('td').html(this.opts.invisibleSpace);

			if (type === 'after') $current_tr.after(new_tr);
			else $current_tr.before(new_tr);

			this.sync();
		},
		tableAddColumn: function (type)
		{
			var parent = this.getParent();
			var $table = $(parent).closest('table');

			if (!this.isParentRedactor($table)) return false;
			if ($table.size() == 0) return false;

			this.bufferSet();

			var index = 0;

			var current = this.getCurrent();
			var $current_tr = $(current).closest('tr');
			var $current_td =  $(current).closest('td');

			$current_tr.find('td').each($.proxy(function(i, elem)
			{
				if ($(elem)[0] === $current_td[0]) index = i;

			}, this));

			$table.find('tr').each($.proxy(function(i, elem)
			{
				var $current = $(elem).find('td').eq(index);

				var td = $current.clone();
				td.html(this.opts.invisibleSpace);

				type === 'after' ? $current.after(td) : $current.before(td);

			}, this));

			this.sync();
		},

		// VIDEO
		videoShow: function()
		{
			this.selectionSave();

			this.modalInit(this.opts.curLang.video, this.opts.modal_video, 600, $.proxy(function()
			{
				$('#redactor_insert_video_btn').click($.proxy(this.videoInsert, this));

				setTimeout(function()
				{
					$('#redactor_insert_video_area').focus();

				}, 200);

			}, this));
		},
		videoInsert: function ()
		{
			var data = $('#redactor_insert_video_area').val();
			data = this.cleanStripTags(data);

			// parse if it is link on youtube & vimeo
			var iframeStart = '<iframe width="500" height="281" src="',
				iframeEnd = '" frameborder="0" allowfullscreen></iframe>';

			if (data.match(reUrlYoutube))
			{
				data = data.replace(reUrlYoutube, iframeStart + '//www.youtube.com/embed/$1' + iframeEnd);
			}
			else if (data.match(reUrlVimeo))
			{
				data = data.replace(reUrlVimeo, iframeStart + '//player.vimeo.com/video/$2' + iframeEnd);
			}

			this.selectionRestore();

			var current = this.getBlock() || this.getCurrent();

			if (current) $(current).after(data)
			else this.insertHtmlAdvanced(data, false);

			this.sync();
			this.modalClose();
		},


		// LINK
		linkShow: function()
		{
			this.selectionSave();

			var callback = $.proxy(function()
			{
				// Predefined links
				if (this.opts.predefinedLinks !== false)
				{
					this.predefinedLinksStorage = {};
					var that = this;
					$.getJSON(this.opts.predefinedLinks, function(data)
					{
						var $select = $('#redactor-predefined-links');
						$select .html('');
						$.each(data, function(key, val)
						{
							that.predefinedLinksStorage[key] = val;
							$select.append($('<option>').val(key).html(val.name));
						});

						$select.on('change', function()
						{
							var key = $(this).val();
							var name = '', url = '';
							if (key != 0)
							{
								name = that.predefinedLinksStorage[key].name;
								url = that.predefinedLinksStorage[key].url;
							}

							$('#redactor_link_url').val(url);
							$('#redactor_link_url_text').val(name);

						});

						$select.show();
					});
				}

				this.insert_link_node = false;

				var sel = this.getSelection();
				var url = '', text = '', target = '';

				var elem = this.getParent();
				var par = $(elem).parent().get(0);
				if (par && par.tagName === 'A')
				{
					elem = par;
				}

				if (elem && elem.tagName === 'A')
				{
					url = elem.href;
					text = $(elem).text();
					target = elem.target;

					this.insert_link_node = elem;
				}
				else text = sel.toString();

				$('#redactor_link_url_text').val(text);

				var thref = self.location.href.replace(/\/$/i, '');
				url = url.replace(thref, '');
				url = url.replace(/^\/#/, '#');
				url = url.replace('mailto:', '');

				// remove host from href
				if (this.opts.linkProtocol === false)
				{
					var re = new RegExp('^(http|ftp|https)://' + self.location.host, 'i');
					url = url.replace(re, '');
				}

				// set url
				$('#redactor_link_url').val(url);

				if (target === '_blank')
				{
					$('#redactor_link_blank').prop('checked', true);
				}

				this.linkInsertPressed = false;
				$('#redactor_insert_link_btn').on('click', $.proxy(this.linkProcess, this));


				setTimeout(function()
				{
					$('#redactor_link_url').focus();

				}, 200);

			}, this);

			this.modalInit(this.opts.curLang.link, this.opts.modal_link, 460, callback);

		},
		linkProcess: function()
		{
			if (this.linkInsertPressed)
			{
				return;
			}

			this.linkInsertPressed = true;
			var target = '', targetBlank = '';

			var link = $('#redactor_link_url').val();
			var text = $('#redactor_link_url_text').val();

			// mailto
			if (link.search('@') != -1 && /(http|ftp|https):\/\//i.test(link) === false)
			{
				link = 'mailto:' + link;
			}
			// url, not anchor
			else if (link.search('#') != 0)
			{
				if ($('#redactor_link_blank').prop('checked'))
				{
					target = ' target="_blank"';
					targetBlank = '_blank';
				}

				// test url (add protocol)
				var pattern = '((xn--)?[a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}';
				var re = new RegExp('^(http|ftp|https)://' + pattern, 'i');
				var re2 = new RegExp('^' + pattern, 'i');

				if (link.search(re) == -1 && link.search(re2) == 0 && this.opts.linkProtocol)
				{
					link = this.opts.linkProtocol + link;
				}
			}

			text = text.replace(/<|>/g, '');
			var extra = '&nbsp;';
			if (this.browser('mozilla'))
			{
				extra = '&nbsp;';
			}

			this.linkInsert('<a href="' + link + '"' + target + '>' + text + '</a>' + extra, $.trim(text), link, targetBlank);

		},
		linkInsert: function (a, text, link, target)
		{
			this.selectionRestore();

			if (text !== '')
			{
				if (this.insert_link_node)
				{
					this.bufferSet();

					$(this.insert_link_node).text(text).attr('href', link);

					if (target !== '')
					{
						$(this.insert_link_node).attr('target', target);
					}
					else
					{
						$(this.insert_link_node).removeAttr('target');
					}
				}
				else
				{
					var $a = $(a).addClass('redactor-added-link');
					this.exec('inserthtml', this.outerHtml($a), false);

					var link = this.$editor.find('a.redactor-added-link');

					link.removeAttr('style').removeClass('redactor-added-link').each(function()
					{
						if (this.className == '') $(this).removeAttr('class');
					});

				}

				this.sync();
			}

			// link tooltip
			setTimeout($.proxy(function()
			{
				if (this.opts.observeLinks) this.observeLinks();

			}, this), 5);

			this.modalClose();
		},

		// FILE
		fileShow: function ()
		{

			this.selectionSave();

			var callback = $.proxy(function()
			{
				var sel = this.getSelection();

				var text = '';
				if (this.oldIE()) text = sel.text;
				else text = sel.toString();

				$('#redactor_filename').val(text);

				// dragupload
				if (!this.isMobile() && !this.isIPad())
				{
					this.draguploadInit('#redactor_file', {
						url: this.opts.fileUpload,
						uploadFields: this.opts.uploadFields,
						success: $.proxy(this.fileCallback, this),
						error: $.proxy( function(obj, json)
						{
							this.callback('fileUploadError', json);

						}, this),
						uploadParam: this.opts.fileUploadParam
					});
				}

				this.uploadInit('redactor_file', {
					auto: true,
					url: this.opts.fileUpload,
					success: $.proxy(this.fileCallback, this),
					error: $.proxy(function(obj, json)
					{
						this.callback('fileUploadError', json);

					}, this)
				});

			}, this);

			this.modalInit(this.opts.curLang.file, this.opts.modal_file, 500, callback);
		},
		fileCallback: function(json)
		{

			this.selectionRestore();

			if (json !== false)
			{

				var text = $('#redactor_filename').val();
				if (text === '') text = json.filename;

				var link = '<a href="' + json.filelink + '" id="filelink-marker">' + text + '</a>';

				// chrome fix
				if (this.browser('webkit') && !!this.window.chrome)
				{
					link = link + '&nbsp;';
				}

				this.execCommand('inserthtml', link, false);

				var linkmarker = $(this.$editor.find('a#filelink-marker'));
				if (linkmarker.size() != 0) linkmarker.removeAttr('id');
				else linkmarker = false;

				this.sync();

				// file upload callback
				this.callback('fileUpload', linkmarker, json);
			}

			this.modalClose();
		},

		// IMAGE
		imageShow: function()
		{

			this.selectionSave();

			var callback = $.proxy(function()
			{
				// json
				if (this.opts.imageGetJson)
				{

					$.getJSON(this.opts.imageGetJson, $.proxy(function(data)
					{
						var folders = {}, count = 0;

						// folders
						$.each(data, $.proxy(function(key, val)
						{
							if (typeof val.folder !== 'undefined')
							{
								count++;
								folders[val.folder] = count;
							}

						}, this));

						var folderclass = false;
						$.each(data, $.proxy(function(key, val)
						{
							// title
							var thumbtitle = '';
							if (typeof val.title !== 'undefined') thumbtitle = val.title;

							var folderkey = 0;
							if (!$.isEmptyObject(folders) && typeof val.folder !== 'undefined')
							{
								folderkey = folders[val.folder];
								if (folderclass === false) folderclass = '.redactorfolder' + folderkey;
							}

							var img = $('<img src="' + val.thumb + '" class="redactorfolder redactorfolder' + folderkey + '" rel="' + val.image + '" title="' + thumbtitle + '" />');
							$('#redactor_image_box').append(img);
							$(img).click($.proxy(this.imageThumbClick, this));

						}, this));

						// folders
						if (!$.isEmptyObject(folders))
						{
							$('.redactorfolder').hide();
							$(folderclass).show();

							var onchangeFunc = function(e)
							{
								$('.redactorfolder').hide();
								$('.redactorfolder' + $(e.target).val()).show();
							};

							var select = $('<select id="redactor_image_box_select">');
							$.each( folders, function(k, v)
							{
								select.append( $('<option value="' + v + '">' + k + '</option>'));
							});

							$('#redactor_image_box').before(select);
							select.change(onchangeFunc);
						}
					}, this));

				}
				else
				{
					$('#redactor-tab-control-2').remove();
				}

				if (this.opts.imageUpload || this.opts.s3)
				{
					// dragupload
					if (!this.isMobile()  && !this.isIPad() && this.opts.s3 === false)
					{
						if ($('#redactor_file' ).length)
						{
							this.draguploadInit('#redactor_file', {
								url: this.opts.imageUpload,
								uploadFields: this.opts.uploadFields,
								success: $.proxy(this.imageCallback, this),
								error: $.proxy(function(obj, json)
								{
									this.callback('imageUploadError', json);

								}, this),
								uploadParam: this.opts.imageUploadParam
							});
						}
					}

					if (this.opts.s3 === false)
					{
						// ajax upload
						this.uploadInit('redactor_file', {
							auto: true,
							url: this.opts.imageUpload,
							success: $.proxy(this.imageCallback, this),
							error: $.proxy(function(obj, json)
							{
								this.callback('imageUploadError', json);

							}, this)
						});
					}
					// s3 upload
					else
					{
						$('#redactor_file').on('change.redactor', $.proxy(this.s3handleFileSelect, this));
					}

				}
				else
				{
					$('.redactor_tab').hide();
					if (!this.opts.imageGetJson)
					{
						$('#redactor_tabs').remove();
						$('#redactor_tab3').show();
					}
					else
					{
						$('#redactor-tab-control-1').remove();
						$('#redactor-tab-control-2').addClass('redactor_tabs_act');
						$('#redactor_tab2').show();
					}
				}

				if (!this.opts.imageTabLink && (this.opts.imageUpload || this.opts.imageGetJson))
				{
					$('#redactor-tab-control-3').hide();
				}

				$('#redactor_upload_btn').click($.proxy(this.imageCallbackLink, this));

				if (!this.opts.imageUpload && !this.opts.imageGetJson)
				{
					setTimeout(function()
					{
						$('#redactor_file_link').focus();

					}, 200);
				}

			}, this);

			this.modalInit(this.opts.curLang.image, this.opts.modal_image, 610, callback);

		},
		imageEdit: function(image)
		{
			var $el = image;
			var parent = $el.parent().parent();

			var callback = $.proxy(function()
			{
				$('#redactor_file_alt').val($el.attr('alt'));
				$('#redactor_image_edit_src').attr('href', $el.attr('src'));

				if ($el.css('display') == 'block' && $el.css('float') == 'none')
				{
					$('#redactor_form_image_align').val('center');
				}
				else
				{
					$('#redactor_form_image_align').val($el.css('float'));
				}

				if ($(parent).get(0).tagName === 'A')
				{
					$('#redactor_file_link').val($(parent).attr('href'));

					if ($(parent).attr('target') == '_blank')
					{
						$('#redactor_link_blank').prop('checked', true);
					}
				}

				$('#redactor_image_delete_btn').click($.proxy(function()
				{
					this.imageRemove($el);

				}, this));

				$('#redactorSaveBtn').click($.proxy(function()
				{
					this.imageSave($el);

				}, this));

			}, this);

			this.modalInit(this.opts.curLang.edit, this.opts.modal_image_edit, 380, callback);

		},
		imageRemove: function(el)
		{
			var parentLink = $(el).parent().parent();
			var parent = $(el).parent();
			var parentEl = false;

			if (parentLink.length && parentLink[0].tagName === 'A')
			{
				parentEl = true;
				$(parentLink).remove();
			}
			else if (parent.length && parent[0].tagName === 'A')
			{
				parentEl = true;
				$(parent).remove();
			}
			else
			{
				$(el).remove();
			}

			if (parent.length && parent[0].tagName === 'P')
			{
				this.focusWithSaveScroll();

				if (parentEl === false) this.selectionStart(parent);
			}

			// delete callback
			this.callback('imageDelete', el);

			this.modalClose();
			this.sync();
		},
		imageSave: function(el)
		{
			this.imageResizeHide(false);

			var $el = $(el);
			var parent = $el.parent();

			$el.attr('alt', $('#redactor_file_alt').val());

			var floating = $('#redactor_form_image_align').val();
			var margin = '';

			if (floating === 'left')
			{
				margin = '0 ' + this.opts.imageFloatMargin + ' ' + this.opts.imageFloatMargin + ' 0';
				$el.css({ 'float': 'left', 'margin': margin });
			}
			else if (floating === 'right')
			{
				margin = '0 0 ' + this.opts.imageFloatMargin + ' ' + this.opts.imageFloatMargin + '';
				$el.css({ 'float': 'right', 'margin': margin });
			}
			else if (floating === 'center')
			{
				$el.css({ 'float': '', 'display': 'block', 'margin': 'auto' });
			}
			else
			{
				$el.css({ 'float': '', 'display': '', 'margin': '' });
			}

			// as link
			var link = $.trim($('#redactor_file_link').val());
			if (link !== '')
			{
				var target = false;
				if ($('#redactor_link_blank').prop('checked'))
				{
					target = true;
				}

				if (parent.get(0).tagName !== 'A')
				{
					var a = $('<a href="' + link + '">' + this.outerHtml(el) + '</a>');

					if (target)
					{
						a.attr('target', '_blank');
					}

					$el.replaceWith(a);
				}
				else
				{
					parent.attr('href', link);
					if (target)
					{
						parent.attr('target', '_blank');
					}
					else
					{
						parent.removeAttr('target');
					}
				}
			}
			else
			{
				if (parent.get(0).tagName === 'A')
				{
					parent.replaceWith(this.outerHtml(el));
				}
			}

			this.modalClose();
			this.observeImages();
			this.sync();

		},
		imageResizeHide: function(e)
		{
			if (e !== false && $(e.target).parent().size() != 0 && $(e.target).parent()[0].id === 'redactor-image-box')
			{
				return false;
			}

			var imageBox = this.$editor.find('#redactor-image-box');
			if (imageBox.size() == 0)
			{
				return false;
			}

			this.$editor.find('#redactor-image-editter, #redactor-image-resizer').remove();

			imageBox.find('img').css({
				marginTop: imageBox[0].style.marginTop,
				marginBottom: imageBox[0].style.marginBottom,
				marginLeft: imageBox[0].style.marginLeft,
				marginRight: imageBox[0].style.marginRight
			});

			imageBox.css('margin', '');


			imageBox.find('img').css('opacity', '');
			imageBox.replaceWith(function()
			{
				return $(this).contents();
			});

			$(document).off('click.redactor-image-resize-hide');
			this.$editor.off('click.redactor-image-resize-hide');
			this.$editor.off('keydown.redactor-image-delete');

			this.sync()

		},
		imageResize: function(image)
		{
			var $image = $(image);

			$image.on('mousedown', $.proxy(function()
			{
				this.imageResizeHide(false);
			}, this));

			$image.on('dragstart', $.proxy(function()
			{
				this.$editor.on('drop.redactor-image-inside-drop', $.proxy(function()
				{
					setTimeout($.proxy(function()
					{
						this.observeImages();
						this.$editor.off('drop.redactor-image-inside-drop');
						this.sync();

					}, this), 1);

				},this));
			}, this));

			$image.on('click', $.proxy(function(e)
			{
				if (this.$editor.find('#redactor-image-box').size() != 0)
				{
					return false;
				}

				var clicked = false,
				start_x,
				start_y,
				ratio = $image.width() / $image.height(),
				min_w = 20,
				min_h = 10;

				var imageResizer = this.imageResizeControls($image);

				// resize
				var isResizing = false;
				if (imageResizer !== false)
				{
					imageResizer.on('mousedown', function(e)
					{
						isResizing = true;
						e.preventDefault();

						ratio = $image.width() / $image.height();

						start_x = Math.round(e.pageX - $image.eq(0).offset().left);
						start_y = Math.round(e.pageY - $image.eq(0).offset().top);

					});

					$(this.document.body).on('mousemove', $.proxy(function(e)
					{
						if (isResizing)
						{
							var mouse_x = Math.round(e.pageX - $image.eq(0).offset().left) - start_x;
							var mouse_y = Math.round(e.pageY - $image.eq(0).offset().top) - start_y;

							var div_h = $image.height();

							var new_h = parseInt(div_h, 10) + mouse_y;
							var new_w = Math.round(new_h * ratio);

							if (new_w > min_w)
							{
								$image.width(new_w);

								if (new_w < 100)
								{
									this.imageEditter.css({
										marginTop: '-7px',
										marginLeft: '-13px',
										fontSize: '9px',
										padding: '3px 5px'
									});
								}
								else
								{
									this.imageEditter.css({
										marginTop: '-11px',
										marginLeft: '-18px',
										fontSize: '11px',
										padding: '7px 10px'
									});
								}
							}

							start_x = Math.round(e.pageX - $image.eq(0).offset().left);
							start_y = Math.round(e.pageY - $image.eq(0).offset().top);

							this.sync()
						}
					}, this)).on('mouseup', function()
					{
						isResizing = false;
					});
				}


				this.$editor.on('keydown.redactor-image-delete', $.proxy(function(e)
				{
					var key = e.which;

					if (this.keyCode.BACKSPACE == key || this.keyCode.DELETE == key)
					{
						this.bufferSet(false);
						this.imageResizeHide(false);
						this.imageRemove($image);
					}

				}, this));

				$(document).on('click.redactor-image-resize-hide', $.proxy(this.imageResizeHide, this));
				this.$editor.on('click.redactor-image-resize-hide', $.proxy(this.imageResizeHide, this));


			}, this));
		},
		imageResizeControls: function($image)
		{
			var imageBox = $('<span id="redactor-image-box" data-redactor="verified">');
			imageBox.css({
				position: 'relative',
				display: 'inline-block',
				lineHeight: 0,
				outline: '1px dashed rgba(0, 0, 0, .6)',
				'float': $image.css('float')
			});
			imageBox.attr('contenteditable', false);

			if ($image[0].style.margin != 'auto')
			{
				imageBox.css({
					marginTop: $image[0].style.marginTop,
					marginBottom: $image[0].style.marginBottom,
					marginLeft: $image[0].style.marginLeft,
					marginRight: $image[0].style.marginRight
				});

				$image.css('margin', '');
			}
			else
			{
				imageBox.css({ 'display': 'block', 'margin': 'auto' });
			}

			$image.css('opacity', .5).after(imageBox);

			// editter
			this.imageEditter = $('<span id="redactor-image-editter" data-redactor="verified">' + this.opts.curLang.edit + '</span>');
			this.imageEditter.css({
				position: 'absolute',
				zIndex: 5,
				top: '50%',
				left: '50%',
				marginTop: '-11px',
				marginLeft: '-18px',
				lineHeight: 1,
				backgroundColor: '#000',
				color: '#fff',
				fontSize: '11px',
				padding: '7px 10px',
				cursor: 'pointer'
			});
			this.imageEditter.attr('contenteditable', false);
			this.imageEditter.on('click', $.proxy(function()
			{
				this.imageEdit($image);
			}, this));
			imageBox.append(this.imageEditter);

			// resizer
			if (this.opts.imageResizable)
			{
				var imageResizer = $('<span id="redactor-image-resizer" data-redactor="verified"></span>');
				imageResizer.css({
					position: 'absolute',
					zIndex: 2,
					lineHeight: 1,
					cursor: 'nw-resize',
					bottom: '-4px',
					right: '-5px',
					border: '1px solid #fff',
					backgroundColor: '#000',
					width: '8px',
					height: '8px'
				});
				imageResizer.attr('contenteditable', false);
				imageBox.append(imageResizer);

				imageBox.append($image);

				return imageResizer;
			}
			else
			{
				imageBox.append($image);

				return false;
			}
		},
		imageThumbClick: function(e)
		{
			var img = '<img id="image-marker" src="' + $(e.target).attr('rel') + '" alt="' + $(e.target).attr('title') + '" />';

			var parent = this.getParent();
			if (this.opts.paragraphy && $(parent).closest('li').size() == 0) img = '<p>' + img + '</p>';

			this.imageInsert(img, true);
		},
		imageCallbackLink: function()
		{
			var val = $('#redactor_file_link').val();

			if (val !== '')
			{
				var data = '<img id="image-marker" src="' + val + '" />';
				if (this.opts.linebreaks === false) data = '<p>' + data + '</p>';

				this.imageInsert(data, true);

			}
			else this.modalClose();
		},
		imageCallback: function(data)
		{
			this.imageInsert(data);
		},
		imageInsert: function(json, link)
		{
			this.selectionRestore();

			if (json !== false)
			{
				var html = '';
				if (link !== true)
				{
					html = '<img id="image-marker" src="' + json.filelink + '" />';

					var parent = this.getParent();
					if (this.opts.paragraphy && $(parent).closest('li').size() == 0)
					{
						html = '<p>' + html + '</p>';
					}
				}
				else
				{
					html = json;
				}

				this.execCommand('inserthtml', html, false);

				var image = $(this.$editor.find('img#image-marker'));

				if (image.length) image.removeAttr('id');
				else image = false;

				this.sync();

				// upload image callback
				link !== true && this.callback('imageUpload', image, json);
			}

			this.modalClose();
			this.observeImages();
		},

		// PROGRESS BAR
		buildProgressBar: function()
		{
			if ($('#redactor-progress').size() != 0) return;

			this.$progressBar = $('<div id="redactor-progress"><span></span></div>');
			$(document.body).append(this.$progressBar);
		},
		showProgressBar: function()
		{
			this.buildProgressBar();
			$('#redactor-progress').fadeIn();
		},
		hideProgressBar: function()
		{
			$('#redactor-progress').fadeOut(1500);
		},

		// MODAL
		modalTemplatesInit: function()
		{
			$.extend( this.opts,
			{
				modal_file: String()
				+ '<section id="redactor-modal-file-insert">'
					+ '<form id="redactorUploadFileForm" method="post" action="" enctype="multipart/form-data">'
						+ '<label>' + this.opts.curLang.filename + '</label>'
						+ '<input type="text" id="redactor_filename" class="redactor_input" />'
						+ '<div style="margin-top: 7px;">'
							+ '<input type="file" id="redactor_file" name="' + this.opts.fileUploadParam + '" />'
						+ '</div>'
					+ '</form>'
				+ '</section>',

				modal_image_edit: String()
				+ '<section id="redactor-modal-image-edit">'
					+ '<label>' + this.opts.curLang.title + '</label>'
					+ '<input type="text" id="redactor_file_alt" class="redactor_input" />'
					+ '<label>' + this.opts.curLang.link + '</label>'
					+ '<input type="text" id="redactor_file_link" class="redactor_input" />'
					+ '<label><input type="checkbox" id="redactor_link_blank"> ' + this.opts.curLang.link_new_tab + '</label>'
					+ '<label>' + this.opts.curLang.image_position + '</label>'
					+ '<select id="redactor_form_image_align">'
						+ '<option value="none">' + this.opts.curLang.none + '</option>'
						+ '<option value="left">' + this.opts.curLang.left + '</option>'
						+ '<option value="center">' + this.opts.curLang.center + '</option>'
						+ '<option value="right">' + this.opts.curLang.right + '</option>'
					+ '</select>'
				+ '</section>'
				+ '<footer>'
					+ '<button id="redactor_image_delete_btn" class="redactor_modal_btn redactor_modal_delete_btn">' + this.opts.curLang._delete + '</button>'
					+ '<button class="redactor_modal_btn redactor_btn_modal_close">' + this.opts.curLang.cancel + '</button>'
					+ '<button id="redactorSaveBtn" class="redactor_modal_btn redactor_modal_action_btn">' + this.opts.curLang.save + '</button>'
				+ '</footer>',

				modal_image: String()
				+ '<section id="redactor-modal-image-insert">'
					+ '<div id="redactor_tabs">'
						+ '<a href="#" id="redactor-tab-control-1" class="redactor_tabs_act">' + this.opts.curLang.upload + '</a>'
						+ '<a href="#" id="redactor-tab-control-2">' + this.opts.curLang.choose + '</a>'
						+ '<a href="#" id="redactor-tab-control-3">' + this.opts.curLang.link + '</a>'
					+ '</div>'
					+ '<form id="redactorInsertImageForm" method="post" action="" enctype="multipart/form-data">'
						+ '<div id="redactor_tab1" class="redactor_tab">'
							+ '<input type="file" id="redactor_file" name="' + this.opts.imageUploadParam + '" />'
						+ '</div>'
						+ '<div id="redactor_tab2" class="redactor_tab" style="display: none;">'
							+ '<div id="redactor_image_box"></div>'
						+ '</div>'
					+ '</form>'
					+ '<div id="redactor_tab3" class="redactor_tab" style="display: none;">'
						+ '<label>' + this.opts.curLang.image_web_link + '</label>'
						+ '<input type="text" name="redactor_file_link" id="redactor_file_link" class="redactor_input"  /><br><br>'
					+ '</div>'
				+ '</section>'
				+ '<footer>'
					+ '<button class="redactor_modal_btn redactor_btn_modal_close">' + this.opts.curLang.cancel + '</button>'
					+ '<button class="redactor_modal_btn redactor_modal_action_btn" id="redactor_upload_btn">' + this.opts.curLang.insert + '</button>'
				+ '</footer>',

				modal_link: String()
				+ '<section id="redactor-modal-link-insert">'
					+ '<select id="redactor-predefined-links" style="width: 99.5%; display: none;"></select>'
					+ '<label>URL</label>'
					+ '<input type="text" class="redactor_input" id="redactor_link_url" />'
					+ '<label>' + this.opts.curLang.text + '</label>'
					+ '<input type="text" class="redactor_input" id="redactor_link_url_text" />'
					+ '<label><input type="checkbox" id="redactor_link_blank"> ' + this.opts.curLang.link_new_tab + '</label>'
				+ '</section>'
				+ '<footer>'
					+ '<button class="redactor_modal_btn redactor_btn_modal_close">' + this.opts.curLang.cancel + '</button>'
					+ '<button id="redactor_insert_link_btn" class="redactor_modal_btn redactor_modal_action_btn">' + this.opts.curLang.insert + '</button>'
				+ '</footer>',

				modal_table: String()
				+ '<section id="redactor-modal-table-insert">'
					+ '<label>' + this.opts.curLang.rows + '</label>'
					+ '<input type="text" size="5" value="2" id="redactor_table_rows" />'
					+ '<label>' + this.opts.curLang.columns + '</label>'
					+ '<input type="text" size="5" value="3" id="redactor_table_columns" />'
				+ '</section>'
				+ '<footer>'
					+ '<button class="redactor_modal_btn redactor_btn_modal_close">' + this.opts.curLang.cancel + '</button>'
					+ '<button id="redactor_insert_table_btn" class="redactor_modal_btn redactor_modal_action_btn">' + this.opts.curLang.insert + '</button>'
				+ '</footer>',

				modal_video: String()
				+ '<section id="redactor-modal-video-insert">'
					+ '<form id="redactorInsertVideoForm">'
						+ '<label>' + this.opts.curLang.video_html_code + '</label>'
						+ '<textarea id="redactor_insert_video_area" style="width: 99%; height: 160px;"></textarea>'
					+ '</form>'
				+ '</section>'
				+ '<footer>'
					+ '<button class="redactor_modal_btn redactor_btn_modal_close">' + this.opts.curLang.cancel + '</button>'
					+ '<button id="redactor_insert_video_btn" class="redactor_modal_btn redactor_modal_action_btn">' + this.opts.curLang.insert + '</button>'
				+ '</footer>'

			});
		},
		modalInit: function(title, content, width, callback)
		{
			this.modalSetOverlay();

			this.$redactorModalWidth = width;
			this.$redactorModal = $('#redactor_modal');

			if (!this.$redactorModal.length)
			{
				this.$redactorModal = $('<div id="redactor_modal" style="display: none;" />');
				this.$redactorModal.append($('<div id="redactor_modal_close">&times;</div>'));
				this.$redactorModal.append($('<header id="redactor_modal_header" />'));
				this.$redactorModal.append($('<div id="redactor_modal_inner" />'));
				this.$redactorModal.appendTo(document.body);
			}

			$('#redactor_modal_close').on('click', $.proxy(this.modalClose, this));
			$(document).keyup($.proxy(this.modalCloseHandler, this));
			this.$editor.keyup($.proxy(this.modalCloseHandler, this));

			this.modalSetContent(content);
			this.modalSetTitle(title);
			this.modalSetDraggable();
			this.modalLoadTabs();
			this.modalOnCloseButton();
			this.modalSetButtonsWidth();

			this.saveModalScroll = this.document.body.scrollTop;
			if (this.opts.autoresize === false)
			{
				this.saveModalScroll = this.$editor.scrollTop();
			}

			if (this.isMobile() === false) this.modalShowOnDesktop();
			else this.modalShowOnMobile();

			// modal actions callback
			if (typeof callback === 'function')
			{
				callback();
			}

			// modal shown callback
			setTimeout($.proxy(function()
			{
				this.callback('modalOpened', this.$redactorModal);

			}, this), 11);

			// fix bootstrap modal focus
			$(document).off('focusin.modal');

			// enter
			this.$redactorModal.find('input[type=text]').on('keypress', $.proxy(function(e)
			{
				if (e.which === 13)
				{
					this.$redactorModal.find('.redactor_modal_action_btn').click();
					e.preventDefault();
				}
			}, this));

			return this.$redactorModal;

		},
		modalShowOnDesktop: function()
		{
			this.$redactorModal.css({
				position: 'fixed',
				top: '-2000px',
				left: '50%',
				width: this.$redactorModalWidth + 'px',
				marginLeft: '-' + (this.$redactorModalWidth / 2) + 'px'
			}).show();

			this.modalSaveBodyOveflow = $(document.body).css('overflow');
			$(document.body).css('overflow', 'hidden');

			setTimeout($.proxy(function()
			{
				var height = this.$redactorModal.outerHeight();
				this.$redactorModal.css({
					top: '50%',
					height: 'auto',
					minHeight: 'auto',
					marginTop: '-' + (height + 10) / 2 + 'px'
				});
			}, this), 15);
		},
		modalShowOnMobile: function()
		{
			this.$redactorModal.css({
				position: 'fixed',
				width: '100%',
				height: '100%',
				top: '0',
				left: '0',
				margin: '0',
				minHeight: '300px'
			}).show();
		},
		modalSetContent: function(content)
		{
			this.modalcontent = false;
			if (content.indexOf('#') == 0)
			{
				this.modalcontent = $(content);
				$('#redactor_modal_inner').empty().append(this.modalcontent.html());
				this.modalcontent.html('');

			}
			else
			{
				$('#redactor_modal_inner').empty().append(content);
			}
		},
		modalSetTitle: function(title)
		{
			this.$redactorModal.find('#redactor_modal_header').html(title);
		},
		modalSetButtonsWidth: function()
		{
			var buttons = this.$redactorModal.find('footer button').not('.redactor_modal_btn_hidden');
			var buttonsSize = buttons.size();
			if (buttonsSize > 0)
			{
				$(buttons).css('width', (this.$redactorModalWidth/buttonsSize) + 'px')
			}
		},
		modalOnCloseButton: function()
		{
			this.$redactorModal.find('.redactor_btn_modal_close').on('click', $.proxy(this.modalClose, this));
		},
		modalSetOverlay: function()
		{
			if (this.opts.modalOverlay)
			{
				this.$redactorModalOverlay = $('#redactor_modal_overlay');
				if (!this.$redactorModalOverlay.length)
				{
					this.$redactorModalOverlay = $('<div id="redactor_modal_overlay" style="display: none;"></div>');
					$('body').prepend(this.$redactorModalOverlay);
				}

				this.$redactorModalOverlay.show().on('click', $.proxy(this.modalClose, this));
			}
		},
		modalSetDraggable: function()
		{
			if (typeof $.fn.draggable !== 'undefined')
			{
				this.$redactorModal.draggable({ handle: '#redactor_modal_header' });
				this.$redactorModal.find('#redactor_modal_header').css('cursor', 'move');
			}
		},
		modalLoadTabs: function()
		{
			var $redactor_tabs = $('#redactor_tabs');
			if (!$redactor_tabs.length) return false;

			var that = this;
			$redactor_tabs.find('a').each(function(i, s)
			{
				i++;
				$(s).on('click', function(e)
				{
					e.preventDefault();

					$redactor_tabs.find('a').removeClass('redactor_tabs_act');
					$(this).addClass('redactor_tabs_act');
					$('.redactor_tab').hide();
					$('#redactor_tab' + i ).show();
					$('#redactor_tab_selected').val(i);

					if (that.isMobile() === false)
					{
						var height = that.$redactorModal.outerHeight();
						that.$redactorModal.css('margin-top', '-' + (height + 10) / 2 + 'px');
					}
				});
			});

		},
		modalCloseHandler: function(e)
		{
			if (e.keyCode === this.keyCode.ESC)
			{
				this.modalClose();
				return false;
			}
		},
		modalClose: function()
		{
			$('#redactor_modal_close').off('click', this.modalClose);
			$('#redactor_modal').fadeOut('fast', $.proxy(function()
			{
				var redactorModalInner = $('#redactor_modal_inner');

				if (this.modalcontent !== false)
				{
					this.modalcontent.html(redactorModalInner.html());
					this.modalcontent = false;
				}

				redactorModalInner.html('');

				if (this.opts.modalOverlay)
				{
					$('#redactor_modal_overlay').hide().off('click', this.modalClose);
				}

				$(document).unbind('keyup', this.hdlModalClose);
				this.$editor.unbind('keyup', this.hdlModalClose);

				this.selectionRestore();

				// restore scroll
				if (this.opts.autoresize && this.saveModalScroll)
				{
					$(this.document.body).scrollTop(this.saveModalScroll);
				}
				else if (this.opts.autoresize === false && this.saveModalScroll)
				{
					this.$editor.scrollTop(this.saveModalScroll);
				}

				this.callback('modalClosed');

			}, this));


			if (this.isMobile() === false)
			{
				$(document.body).css('overflow', this.modalSaveBodyOveflow ? this.modalSaveBodyOveflow : 'visible');
			}

			return false;
		},
		modalSetTab: function(num)
		{
			$('.redactor_tab').hide();
			$('#redactor_tabs').find('a').removeClass('redactor_tabs_act').eq(num - 1).addClass('redactor_tabs_act');
			$('#redactor_tab' + num).show();
		},

		// S3
		s3handleFileSelect: function(e)
		{
			var files = e.target.files;

			for (var i = 0, f; f = files[i]; i++)
			{
				this.s3uploadFile(f);
			}
		},
		s3uploadFile: function(file)
		{
			this.s3executeOnSignedUrl(file, $.proxy(function(signedURL)
			{
				this.s3uploadToS3(file, signedURL);
			}, this));
		},
		s3executeOnSignedUrl: function(file, callback)
		{
			var xhr = new XMLHttpRequest();

			var mark = '?';
			if (this.opts.s3.search(/\?/) != '-1') mark = '&';

			xhr.open('GET', this.opts.s3 + mark + 'name=' + file.name + '&type=' + file.type, true);

			// Hack to pass bytes through unprocessed.
			if (xhr.overrideMimeType) xhr.overrideMimeType('text/plain; charset=x-user-defined');

			var that = this;
			xhr.onreadystatechange = function(e)
			{
				if (this.readyState == 4 && this.status == 200)
				{
					that.showProgressBar();
					callback(decodeURIComponent(this.responseText));
				}
				else if(this.readyState == 4 && this.status != 200)
				{
					//setProgress(0, 'Could not contact signing script. Status = ' + this.status);
				}
			};

			xhr.send();
		},
		s3createCORSRequest: function(method, url)
		{
			var xhr = new XMLHttpRequest();
			if ("withCredentials" in xhr)
			{
				xhr.open(method, url, true);
			}
			else if (typeof XDomainRequest != "undefined")
			{
				xhr = new XDomainRequest();
				xhr.open(method, url);
			}
			else
			{
				xhr = null;
			}

			return xhr;
		},
		s3uploadToS3: function(file, url)
		{
			var xhr = this.s3createCORSRequest('PUT', url);
			if (!xhr)
			{
				//setProgress(0, 'CORS not supported');
			}
			else
			{
				xhr.onload = $.proxy(function()
				{
					if (xhr.status == 200)
					{
						//setProgress(100, 'Upload completed.');

						this.hideProgressBar();

						var s3image = url.split('?');

						if (!s3image[0])
						{
							 // url parsing is fail
							 return false;
						}

						this.selectionRestore();

						var html = '';
						html = '<img id="image-marker" src="' + s3image[0] + '" />';
						if (this.opts.paragraphy) html = '<p>' + html + '</p>';

						this.execCommand('inserthtml', html, false);

						var image = $(this.$editor.find('img#image-marker'));

						if (image.length) image.removeAttr('id');
						else image = false;

						this.sync();

						// upload image callback
						this.callback('imageUpload', image, false);

						this.modalClose();
						this.observeImages();

					}
					else
					{
						//setProgress(0, 'Upload error: ' + xhr.status);
					}
				}, this);

				xhr.onerror = function()
				{
					//setProgress(0, 'XHR error.');
				};

				xhr.upload.onprogress = function(e)
				{
					/*
					if (e.lengthComputable)
					{
						var percentLoaded = Math.round((e.loaded / e.total) * 100);
						setProgress(percentLoaded, percentLoaded == 100 ? 'Finalizing.' : 'Uploading.');
					}
					*/
				};

				xhr.setRequestHeader('Content-Type', file.type);
				xhr.setRequestHeader('x-amz-acl', 'public-read');

				xhr.send(file);
			}
		},

		// UPLOAD
		uploadInit: function(el, options)
		{
			this.uploadOptions = {
				url: false,
				success: false,
				error: false,
				start: false,
				trigger: false,
				auto: false,
				input: false
			};

			$.extend(this.uploadOptions, options);

			var $el = $('#' + el);

			// Test input or form
			if ($el.length && $el[0].tagName === 'INPUT')
			{
				this.uploadOptions.input = $el;
				this.el = $($el[0].form);
			}
			else this.el = $el;

			this.element_action = this.el.attr('action');

			// Auto or trigger
			if (this.uploadOptions.auto)
			{
				$(this.uploadOptions.input).change($.proxy(function(e)
				{
					this.el.submit(function(e)
					{
						return false;
					});

					this.uploadSubmit(e);

				}, this));

			}
			else if (this.uploadOptions.trigger)
			{
				$('#' + this.uploadOptions.trigger).click($.proxy(this.uploadSubmit, this));
			}
		},
		uploadSubmit: function(e)
		{
			this.showProgressBar();
			this.uploadForm(this.element, this.uploadFrame());
		},
		uploadFrame: function()
		{
			this.id = 'f' + Math.floor(Math.random() * 99999);

			var d = this.document.createElement('div');
			var iframe = '<iframe style="display:none" id="' + this.id + '" name="' + this.id + '"></iframe>';

			d.innerHTML = iframe;
			$(d).appendTo("body");

			// Start
			if (this.uploadOptions.start) this.uploadOptions.start();

			$( '#' + this.id ).load($.proxy(this.uploadLoaded, this));

			return this.id;
		},
		uploadForm: function(f, name)
		{
			if (this.uploadOptions.input)
			{
				var formId = 'redactorUploadForm' + this.id,
					fileId = 'redactorUploadFile' + this.id;

				this.form = $('<form  action="' + this.uploadOptions.url + '" method="POST" target="' + name + '" name="' + formId + '" id="' + formId + '" enctype="multipart/form-data" />');

				// append hidden fields
				if (this.opts.uploadFields !== false && typeof this.opts.uploadFields === 'object')
				{
					$.each(this.opts.uploadFields, $.proxy(function(k, v)
					{
						if (v != null && v.toString().indexOf('#') === 0) v = $(v).val();

						var hidden = $('<input/>', {
							'type': "hidden",
							'name': k,
							'value': v
						});

						$(this.form).append(hidden);

					}, this));
				}

				var oldElement = this.uploadOptions.input;
				var newElement = $(oldElement).clone();

				$(oldElement).attr('id', fileId).before(newElement).appendTo(this.form);

				$(this.form).css('position', 'absolute')
						.css('top', '-2000px')
						.css('left', '-2000px')
						.appendTo('body');

				this.form.submit();

			}
			else
			{
				f.attr('target', name)
					.attr('method', 'POST')
					.attr('enctype', 'multipart/form-data')
					.attr('action', this.uploadOptions.url);

				this.element.submit();
			}
		},
		uploadLoaded: function()
		{
			var i = $( '#' + this.id)[0], d;

			if (i.contentDocument) d = i.contentDocument;
			else if (i.contentWindow) d = i.contentWindow.document;
			else d = window.frames[this.id].document;

			// Success
			if (this.uploadOptions.success)
			{
				this.hideProgressBar();

				if (typeof d !== 'undefined')
				{
					// Remove bizarre <pre> tag wrappers around our json data:
					var rawString = d.body.innerHTML;
					var jsonString = rawString.match(/\{(.|\n)*\}/)[0];

					jsonString = jsonString.replace(/^\[/, '');
					jsonString = jsonString.replace(/\]$/, '');

					var json = $.parseJSON(jsonString);

					if (typeof json.error == 'undefined') this.uploadOptions.success(json);
					else
					{
						this.uploadOptions.error(this, json);
						this.modalClose();
					}
				}
				else
				{
					this.modalClose();
					alert('Upload failed!');
				}
			}

			this.el.attr('action', this.element_action);
			this.el.attr('target', '');
		},

		// DRAGUPLOAD
		draguploadInit: function (el, options)
		{
			this.draguploadOptions = $.extend({
				url: false,
				success: false,
				error: false,
				preview: false,
				uploadFields: false,
				text: this.opts.curLang.drop_file_here,
				atext: this.opts.curLang.or_choose,
				uploadParam: false
			}, options);

			if (window.FormData === undefined) return false;

			this.droparea = $('<div class="redactor_droparea"></div>');
			this.dropareabox = $('<div class="redactor_dropareabox">' + this.draguploadOptions.text + '</div>');
			this.dropalternative = $('<div class="redactor_dropalternative">' + this.draguploadOptions.atext + '</div>');

			this.droparea.append(this.dropareabox);

			$(el).before(this.droparea);
			$(el).before(this.dropalternative);

			// drag over
			this.dropareabox.on('dragover', $.proxy(function()
			{
				return this.draguploadOndrag();

			}, this));

			// drag leave
			this.dropareabox.on('dragleave', $.proxy(function()
			{
				return this.draguploadOndragleave();

			}, this));

			// drop
			this.dropareabox.get(0).ondrop = $.proxy(function(e)
			{
				e.preventDefault();

				this.dropareabox.removeClass('hover').addClass('drop');
				this.showProgressBar();
				this.dragUploadAjax(this.draguploadOptions.url, e.dataTransfer.files[0], false, e, this.draguploadOptions.uploadParam);

			}, this );
		},
		dragUploadAjax: function(url, file, directupload, e, uploadParam)
		{
			if (!directupload)
			{
				var xhr = $.ajaxSettings.xhr();
				if (xhr.upload)
				{
					xhr.upload.addEventListener('progress', $.proxy(this.uploadProgress, this), false);
				}

				$.ajaxSetup({
				  xhr: function () { return xhr; }
				});
			}

			// drop callback
			this.callback('drop', e);

			var fd = new FormData();

			// append file data
			if (uploadParam !== false)
			{
				fd.append(uploadParam, file);
			}
			else
			{
				fd.append('file', file);
			}

			// append hidden fields
			if (this.opts.uploadFields !== false && typeof this.opts.uploadFields === 'object')
			{
				$.each(this.opts.uploadFields, $.proxy(function(k, v)
				{
					if (v != null && v.toString().indexOf('#') === 0) v = $(v).val();
					fd.append(k, v);

				}, this));
			}

			$.ajax({
				url: url,
				dataType: 'html',
				data: fd,
				cache: false,
				contentType: false,
				processData: false,
				type: 'POST',
				success: $.proxy(function(data)
				{
					data = data.replace(/^\[/, '');
					data = data.replace(/\]$/, '');

					var json = (typeof data === 'string' ? $.parseJSON(data) : data);

					this.hideProgressBar();

					if (directupload)
					{
					    var $img = $('<img>');
						$img.attr('src', json.filelink).attr('id', 'drag-image-marker');

						this.insertNodeToCaretPositionFromPoint(e, $img[0]);

						var image = $(this.$editor.find('img#drag-image-marker'));
						if (image.length) image.removeAttr('id');
						else image = false;

						this.sync();
						this.observeImages();

						// upload callback
						if (image) this.callback('imageUpload', image, json);

						// error callback
						if (typeof json.error !== 'undefined') this.callback('imageUploadError', json);
					}
					else
					{
						if (typeof json.error == 'undefined')
						{
							this.draguploadOptions.success(json);
						}
						else
						{
							this.draguploadOptions.error(this, json);
							this.draguploadOptions.success(false);
						}
					}

				}, this)
			});
		},
		draguploadOndrag: function()
		{
			this.dropareabox.addClass('hover');
			return false;
		},
		draguploadOndragleave: function()
		{
			this.dropareabox.removeClass('hover');
			return false;
		},
		uploadProgress: function(e, text)
		{
			var percent = e.loaded ? parseInt(e.loaded / e.total * 100, 10) : e;
			this.dropareabox.text('Loading ' + percent + '% ' + (text || ''));
		},

		// UTILS
		isMobile: function()
		{
			return /(iPhone|iPod|BlackBerry|Android)/.test(navigator.userAgent);
		},
		isIPad: function()
		{
			return /iPad/.test(navigator.userAgent);
		},
		normalize: function(str)
		{
			if (typeof(str) === 'undefined') return 0;
			return parseInt(str.replace('px',''), 10);
		},
		outerHtml: function(el)
		{
			return $('<div>').append($(el).eq(0).clone()).html();
		},
		stripHtml: function(html)
		{
			var tmp = document.createElement("DIV");
			tmp.innerHTML = html;
			return tmp.textContent || tmp.innerText || "";
		},
		isString: function(obj)
		{
			return Object.prototype.toString.call(obj) == '[object String]';
		},
		isEmpty: function(html)
		{
			html = html.replace(/&#x200b;|<br>|<br\/>|&nbsp;/gi, '');
			html = html.replace(/\s/g, '');
			html = html.replace(/^<p>[^\W\w\D\d]*?<\/p>$/i, '');

			return html == '';
		},
		getInternetExplorerVersion: function()
		{
			var rv = false;
			if (navigator.appName == 'Microsoft Internet Explorer')
			{
				var ua = navigator.userAgent;
				var re  = new RegExp("MSIE ([0-9]{1,}[\.0-9]{0,})");
				if (re.exec(ua) != null)
				{
					rv = parseFloat(RegExp.$1);
				}
			}

			return rv;
		},
		isIe11: function()
		{
			return !!navigator.userAgent.match(/Trident\/7\./);
		},
		browser: function(browser)
		{
			var ua = navigator.userAgent.toLowerCase();
			var match = /(opr)[\/]([\w.]+)/.exec( ua ) ||
            /(chrome)[ \/]([\w.]+)/.exec( ua ) ||
            /(webkit)[ \/]([\w.]+).*(safari)[ \/]([\w.]+)/.exec(ua) ||
            /(webkit)[ \/]([\w.]+)/.exec( ua ) ||
            /(opera)(?:.*version|)[ \/]([\w.]+)/.exec( ua ) ||
            /(msie) ([\w.]+)/.exec( ua ) ||
            ua.indexOf("trident") >= 0 && /(rv)(?::| )([\w.]+)/.exec( ua ) ||
            ua.indexOf("compatible") < 0 && /(mozilla)(?:.*? rv:([\w.]+)|)/.exec( ua ) ||
            [];

			if (browser == 'version') return match[2];
			if (browser == 'webkit') return (match[1] == 'chrome' || match[1] == 'webkit');
			if (match[1] == 'rv') return browser == 'msie';
			if (match[1] == 'opr') return browser == 'webkit';

			return browser == match[1];

		},
		oldIE: function()
		{
			if (this.browser('msie') && parseInt(this.browser('version'), 10) < 9) return true;
			return false;
		},
		getFragmentHtml: function (fragment)
		{
			var cloned = fragment.cloneNode(true);
			var div = this.document.createElement('div');

			div.appendChild(cloned);
			return div.innerHTML;
		},
		extractContent: function()
		{
			var node = this.$editor[0];
			var frag = this.document.createDocumentFragment();
			var child;

			while ((child = node.firstChild))
			{
				frag.appendChild(child);
			}

			return frag;
		},
		isParentRedactor: function(el)
		{
			if (!el) return false;
			if (this.opts.iframe) return el;

			if ($(el).parents('div.redactor_editor').length == 0 || $(el).hasClass('redactor_editor')) return false;
			else return el;
		},
		currentOrParentIs: function(tagName)
		{
			var parent = this.getParent(), current = this.getCurrent();
			return parent && parent.tagName === tagName ? parent : current && current.tagName === tagName ? current : false;
		},
		isEndOfElement: function()
		{
			var current = this.getBlock();
			var offset = this.getCaretOffset(current);

			var text = $.trim($(current).text()).replace(/\n\r\n/g, '');

			var len = text.length;

			if (offset == len) return true;
			else return false;
		},
		isFocused: function()
		{
			var el, sel = this.getSelection();

			if (sel && sel.rangeCount && sel.rangeCount > 0) el = sel.getRangeAt(0).startContainer;
			if (!el) return false;
			if (this.opts.iframe)
			{
				if (this.getCaretOffsetRange().equals()) return !this.$editor.is(el);
				else return true;
			}

			return $(el).closest('div.redactor_editor').length != 0;
		},
		removeEmptyAttr: function (el, attr)
		{
			if ($(el).attr(attr) == '') $(el).removeAttr(attr);
		},
		removeFromArrayByValue: function(array, value)
		{
			var index = null;

			while ((index = array.indexOf(value)) !== -1)
			{
				array.splice(index, 1);
			}

			return array;
		}

	};

	// constructor
	Redactor.prototype.init.prototype = Redactor.prototype;

	// LINKIFY
	$.Redactor.fn.formatLinkify = function(protocol, convertLinks, convertImageLinks, convertVideoLinks, linkSize)
	{
		var url = /(((https?|ftps?):\/\/)|www[.][^\s])(.+?\..+?)([.),]?)(\s|\.\s+|\)|$)/gi,
			rProtocol = /(https?|ftp):\/\//i,
			urlImage = /(https?:\/\/.*\.(?:png|jpg|jpeg|gif))/gi;

		var childNodes = (this.$editor ? this.$editor.get(0) : this).childNodes, i = childNodes.length;
		while (i--)
		{
			var n = childNodes[i];
			if (n.nodeType === 3)
			{
				var html = n.nodeValue;

				// youtube & vimeo
				if (convertVideoLinks && html)
				{
					var iframeStart = '<iframe width="500" height="281" src="',
						iframeEnd = '" frameborder="0" allowfullscreen></iframe>';

					if (html.match(reUrlYoutube))
					{
						html = html.replace(reUrlYoutube, iframeStart + '//www.youtube.com/embed/$1' + iframeEnd);
						$(n).after(html).remove();
					}
					else if (html.match(reUrlVimeo))
					{
						html = html.replace(reUrlVimeo, iframeStart + '//player.vimeo.com/video/$2' + iframeEnd);
						$(n).after(html).remove();
					}
				}

				// image
				if (convertImageLinks && html && html.match(urlImage))
				{
					html = html.replace(urlImage, '<img src="$1">');

					$(n).after(html).remove();
				}

				// link
				if (convertLinks && html && html.match(url))
				{
					var matches = html.match(url);

					for (var i in matches)
					{
						var href = matches[i];
						var text = href;

						var space = '';
						if (href.match(/\s$/) !== null) space = ' ';

						var addProtocol = protocol;
						if (href.match(rProtocol) !== null) addProtocol = '';

						if (text.length > linkSize) text = text.substring(0, linkSize) + '...';

						text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

						/*
							To handle URLs which may have $ characters in them, need to escape $ -> $$ to prevent $1 from getting treated as a backreference.
							See http://gotofritz.net/blog/code-snippets/escaping-in-replace-strings-in-javascript/
						*/
						var escapedBackReferences = text.replace('$', '$$$');

						html = html.replace(href, '<a href=\"' + addProtocol + $.trim(href) + '\">' + $.trim(escapedBackReferences) + '</a>' + space);
					}

					$(n).after(html).remove();
				}
			}
			else if (n.nodeType === 1 && !/^(a|button|textarea)$/i.test(n.tagName))
			{
				$.Redactor.fn.formatLinkify.call(n, protocol, convertLinks, convertImageLinks, convertVideoLinks, linkSize);
			}
		}
	};

})(jQuery);
/*
 * qTip2 - Pretty powerful tooltips - v2.0.1-105
 * http://qtip2.com
 *
 * Copyright (c) 2013 Craig Michael Thompson
 * Released under the MIT, GPL licenses
 * http://jquery.org/license
 *
 * Date: Sun Jun 2 2013 02:19 UTC+0000
 * Plugins: tips modal viewport svg imagemap ie6
 * Styles: basic css3
 */
/*global window: false, jQuery: false, console: false, define: false */

/* Cache window, document, undefined */
(function( window, document, undefined ) {

// Uses AMD or browser globals to create a jQuery plugin.
(function( factory ) {
  "use strict";
  if(typeof define === 'function' && define.amd) {
    define(['jquery'], factory);
  }
  else if(jQuery && !jQuery.fn.qtip) {
    factory(jQuery);
  }
}
(function($) {
  /* This currently causes issues with Safari 6, so for it's disabled */
  //"use strict"; // (Dis)able ECMAScript "strict" operation for this function. See more: http://ejohn.org/blog/ecmascript-5-strict-mode-json-and-more/

;// Munge the primitives - Paul Irish tip
var TRUE = true,
FALSE = false,
NULL = null,

// Common variables
X = 'x', Y = 'y',
WIDTH = 'width',
HEIGHT = 'height',

// Positioning sides
TOP = 'top',
LEFT = 'left',
BOTTOM = 'bottom',
RIGHT = 'right',
CENTER = 'center',

// Position adjustment types
FLIP = 'flip',
FLIPINVERT = 'flipinvert',
SHIFT = 'shift',

// Shortcut vars
QTIP, PROTOTYPE, CORNER, CHECKS,
PLUGINS = {},
NAMESPACE = 'qtip',
ATTR_HAS = 'data-hasqtip',
ATTR_ID = 'data-qtip-id',
WIDGET = ['ui-widget', 'ui-tooltip'],
SELECTOR = '.'+NAMESPACE,
INACTIVE_EVENTS = 'click dblclick mousedown mouseup mousemove mouseleave mouseenter'.split(' '),

CLASS_FIXED = NAMESPACE+'-fixed',
CLASS_DEFAULT = NAMESPACE + '-default',
CLASS_FOCUS = NAMESPACE + '-focus',
CLASS_HOVER = NAMESPACE + '-hover',
CLASS_DISABLED = NAMESPACE+'-disabled',

replaceSuffix = '_replacedByqTip',
oldtitle = 'oldtitle',
trackingBound;

// Browser detection
BROWSER = {
  /*
   * IE version detection
   *
   * Adapted from: http://ajaxian.com/archives/attack-of-the-ie-conditional-comment
   * Credit to James Padolsey for the original implemntation!
   */
  ie: (function(){
    var v = 3, div = document.createElement('div');
    while ((div.innerHTML = '<!--[if gt IE '+(++v)+']><i></i><![endif]-->')) {
      if(!div.getElementsByTagName('i')[0]) { break; }
    }
    return v > 4 ? v : NaN;
  }()),

  /*
   * iOS version detection
   */
  iOS: parseFloat(
    ('' + (/CPU.*OS ([0-9_]{1,5})|(CPU like).*AppleWebKit.*Mobile/i.exec(navigator.userAgent) || [0,''])[1])
    .replace('undefined', '3_2').replace('_', '.').replace('_', '')
  ) || FALSE
};

;function QTip(target, options, id, attr) {
  // Elements and ID
  this.id = id;
  this.target = target;
  this.tooltip = NULL;
  this.elements = elements = { target: target };

  // Internal constructs
  this._id = NAMESPACE + '-' + id;
  this.timers = { img: {} };
  this.options = options;
  this.plugins = {};

  // Cache object
  this.cache = cache = {
    event: {},
    target: $(),
    disabled: FALSE,
    attr: attr,
    onTooltip: FALSE,
    lastClass: ''
  };

  // Set the initial flags
  this.rendered = this.destroyed = this.disabled = this.waiting =
    this.hiddenDuringWait = this.positioning = this.triggering = FALSE;
}
PROTOTYPE = QTip.prototype;

PROTOTYPE.render = function(show) {
  if(this.rendered || this.destroyed) { return this; } // If tooltip has already been rendered, exit

  var self = this,
    options = this.options,
    cache = this.cache,
    elements = this.elements,
    text = options.content.text,
    title = options.content.title,
    button = options.content.button,
    posOptions = options.position,
    namespace = '.'+this._id+' ',
    deferreds = [];

  // Add ARIA attributes to target
  $.attr(this.target[0], 'aria-describedby', this._id);

  // Create tooltip element
  this.tooltip = elements.tooltip = tooltip = $('<div/>', {
    'id': this._id,
    'class': [ NAMESPACE, CLASS_DEFAULT, options.style.classes, NAMESPACE + '-pos-' + options.position.my.abbrev() ].join(' '),
    'width': options.style.width || '',
    'height': options.style.height || '',
    'tracking': posOptions.target === 'mouse' && posOptions.adjust.mouse,

    /* ARIA specific attributes */
    'role': 'alert',
    'aria-live': 'polite',
    'aria-atomic': FALSE,
    'aria-describedby': this._id + '-content',
    'aria-hidden': TRUE
  })
  .toggleClass(CLASS_DISABLED, this.disabled)
  .attr(ATTR_ID, this.id)
  .data(NAMESPACE, this)
  .appendTo(posOptions.container)
  .append(
    // Create content element
    elements.content = $('<div />', {
      'class': NAMESPACE + '-content',
      'id': this._id + '-content',
      'aria-atomic': TRUE
    })
  );

  // Set rendered flag and prevent redundant reposition calls for now
  this.rendered = -1;
  this.positioning = TRUE;

  // Create title...
  if(title) {
    this._createTitle();

    // Update title only if its not a callback (called in toggle if so)
    if(!$.isFunction(title)) {
      deferreds.push( this._updateTitle(title, FALSE) );
    }
  }

  // Create button
  if(button) { this._createButton(); }

  // Set proper rendered flag and update content if not a callback function (called in toggle)
  if(!$.isFunction(text)) {
    deferreds.push( this._updateContent(text, FALSE) );
  }
  this.rendered = TRUE;

  // Setup widget classes
  this._setWidget();

  // Assign passed event callbacks (before plugins!)
  $.each(options.events, function(name, callback) {
    $.isFunction(callback) && tooltip.bind(
      (name === 'toggle' ? ['tooltipshow','tooltiphide'] : ['tooltip'+name])
        .join(namespace)+namespace, callback
    );
  });

  // Initialize 'render' plugins
  $.each(PLUGINS, function(name) {
    var instance;
    if(this.initialize === 'render' && (instance = this(self))) {
      self.plugins[name] = instance;
    }
  });

  // Assign events
  this._assignEvents();

  // When deferreds have completed
  $.when.apply($, deferreds).then(function() {
    // tooltiprender event
    self._trigger('render');

    // Reset flags
    self.positioning = FALSE;

    // Show tooltip if not hidden during wait period
    if(!self.hiddenDuringWait && (options.show.ready || show)) {
      self.toggle(TRUE, cache.event, FALSE);
    }
    self.hiddenDuringWait = FALSE;
  });

  // Expose API
  QTIP.api[this.id] = this;

  return this;
};

PROTOTYPE.destroy = function(immediate) {
  // Set flag the signify destroy is taking place to plugins
  // and ensure it only gets destroyed once!
  if(this.destroyed) { return this.target; }

  function process() {
    if(this.destroyed) { return; }
    this.destroyed = TRUE;

    var target = this.target,
      title = target.attr(oldtitle);

    // Destroy tooltip if rendered
    if(this.rendered) {
      this.tooltip.stop(1,0).find('*').remove().end().remove();
    }

    // Destroy all plugins
    $.each(this.plugins, function(name) {
      this.destroy && this.destroy();
    });

    // Clear timers and remove bound events
    clearTimeout(this.timers.show);
    clearTimeout(this.timers.hide);
    this._unassignEvents();

    // Remove api object and ARIA attributes
    target.removeData(NAMESPACE).removeAttr(ATTR_ID)
      .removeAttr('aria-describedby');

    // Reset old title attribute if removed
    if(this.options.suppress && title) {
      target.attr('title', title).removeAttr(oldtitle);
    }

    // Remove qTip events associated with this API
    this._unbind(target);

    // Remove ID from used id objects, and delete object references
    // for better garbage collection and leak protection
    this.options = this.elements = this.cache = this.timers =
      this.plugins = this.mouse = NULL;

    // Delete epoxsed API object
    delete QTIP.api[this.id];
  }

  // If an immediate destory is needed
  if(immediate !== TRUE && this.rendered) {
    tooltip.one('tooltiphidden', $.proxy(process, this));
    !this.triggering && this.hide();
  }

  // If we're not in the process of hiding... process
  else { process.call(this); }

  return this.target;
};

;function invalidOpt(a) {
  return a === NULL || $.type(a) !== 'object';
}

function invalidContent(c) {
  return !( $.isFunction(c) || (c && c.attr) || c.length || ($.type(c) === 'object' && (c.jquery || c.then) ));
}

// Option object sanitizer
function sanitizeOptions(opts) {
  var content, text, ajax, once;

  if(invalidOpt(opts)) { return FALSE; }

  if(invalidOpt(opts.metadata)) {
    opts.metadata = { type: opts.metadata };
  }

  if('content' in opts) {
    content = opts.content;

    if(invalidOpt(content) || content.jquery || content.done) {
      content = opts.content = {
        text: (text = invalidContent(content) ? FALSE : content)
      };
    }
    else { text = content.text; }

    // DEPRECATED - Old content.ajax plugin functionality
    // Converts it into the proper Deferred syntax
    if('ajax' in content) {
      ajax = content.ajax;
      once = ajax && ajax.once !== FALSE;
      delete content.ajax;

      content.text = function(event, api) {
        var loading = text || $(this).attr(api.options.content.attr) || 'Loading...',

        deferred = $.ajax(
          $.extend({}, ajax, { context: api })
        )
        .then(ajax.success, NULL, ajax.error)
        .then(function(content) {
          if(content && once) { api.set('content.text', content); }
          return content;
        },
        function(xhr, status, error) {
          if(api.destroyed || xhr.status === 0) { return; }
          api.set('content.text', status + ': ' + error);
        });

        return !once ? (api.set('content.text', loading), deferred) : loading;
      };
    }

    if('title' in content) {
      if(!invalidOpt(content.title)) {
        content.button = content.title.button;
        content.title = content.title.text;
      }

      if(invalidContent(content.title || FALSE)) {
        content.title = FALSE;
      }
    }
  }

  if('position' in opts && invalidOpt(opts.position)) {
    opts.position = { my: opts.position, at: opts.position };
  }

  if('show' in opts && invalidOpt(opts.show)) {
    opts.show = opts.show.jquery ? { target: opts.show } :
      opts.show === TRUE ? { ready: TRUE } : { event: opts.show };
  }

  if('hide' in opts && invalidOpt(opts.hide)) {
    opts.hide = opts.hide.jquery ? { target: opts.hide } : { event: opts.hide };
  }

  if('style' in opts && invalidOpt(opts.style)) {
    opts.style = { classes: opts.style };
  }

  // Sanitize plugin options
  $.each(PLUGINS, function() {
    this.sanitize && this.sanitize(opts);
  });

  return opts;
}

// Setup builtin .set() option checks
CHECKS = PROTOTYPE.checks = {
  builtin: {
    // Core checks
    '^id$': function(obj, o, v, prev) {
      var id = v === TRUE ? QTIP.nextid : v,
        new_id = NAMESPACE + '-' + id;

      if(id !== FALSE && id.length > 0 && !$('#'+new_id).length) {
        this._id = new_id;

        if(this.rendered) {
          this.tooltip[0].id = this._id;
          this.elements.content[0].id = this._id + '-content';
          this.elements.title[0].id = this._id + '-title';
        }
      }
      else { obj[o] = prev; }
    },
    '^prerender': function(obj, o, v) {
      v && !this.rendered && this.render(this.options.show.ready);
    },

    // Content checks
    '^content.text$': function(obj, o, v) {
      this._updateContent(v);
    },
    '^content.attr$': function(obj, o, v, prev) {
      if(this.options.content.text === this.target.attr(prev)) {
        this._updateContent( this.target.attr(v) );
      }
    },
    '^content.title$': function(obj, o, v) {
      // Remove title if content is null
      if(!v) { return this._removeTitle(); }

      // If title isn't already created, create it now and update
      v && !this.elements.title && this._createTitle();
      this._updateTitle(v);
    },
    '^content.button$': function(obj, o, v) {
      this._updateButton(v);
    },
    '^content.title.(text|button)$': function(obj, o, v) {
      this.set('content.'+o, v); // Backwards title.text/button compat
    },

    // Position checks
    '^position.(my|at)$': function(obj, o, v){
      'string' === typeof v && (obj[o] = new CORNER(v, o === 'at'));
    },
    '^position.container$': function(obj, o, v){
      this.tooltip.appendTo(v);
    },

    // Show checks
    '^show.ready$': function(obj, o, v) {
      v && (!this.rendered && this.render(TRUE) || this.toggle(TRUE));
    },

    // Style checks
    '^style.classes$': function(obj, o, v, p) {
      this.tooltip.removeClass(p).addClass(v);
    },
    '^style.width|height': function(obj, o, v) {
      this.tooltip.css(o, v);
    },
    '^style.widget|content.title': function() {
      this._setWidget();
    },
    '^style.def': function(obj, o, v) {
      this.tooltip.toggleClass(CLASS_DEFAULT, !!v);
    },

    // Events check
    '^events.(render|show|move|hide|focus|blur)$': function(obj, o, v) {
      tooltip[($.isFunction(v) ? '' : 'un') + 'bind']('tooltip'+o, v);
    },

    // Properties which require event reassignment
    '^(show|hide|position).(event|target|fixed|inactive|leave|distance|viewport|adjust)': function() {
      var posOptions = this.options.position;

      // Set tracking flag
      tooltip.attr('tracking', posOptions.target === 'mouse' && posOptions.adjust.mouse);

      // Reassign events
      this._unassignEvents();
      this._assignEvents();
    }
  }
};

// Dot notation converter
function convertNotation(options, notation) {
  var i = 0, obj, option = options,

  // Split notation into array
  levels = notation.split('.');

  // Loop through
  while( option = option[ levels[i++] ] ) {
    if(i < levels.length) { obj = option; }
  }

  return [obj || options, levels.pop()];
}

PROTOTYPE.get = function(notation) {
  if(this.destroyed) { return this; }

  var o = convertNotation(this.options, notation.toLowerCase()),
    result = o[0][ o[1] ];

  return result.precedance ? result.string() : result;
};

function setCallback(notation, args) {
  var category, rule, match;

  for(category in this.checks) {
    for(rule in this.checks[category]) {
      if(match = (new RegExp(rule, 'i')).exec(notation)) {
        args.push(match);

        if(category === 'builtin' || this.plugins[category]) {
          this.checks[category][rule].apply(
            this.plugins[category] || this, args
          );
        }
      }
    }
  }
}

var rmove = /^position\.(my|at|adjust|target|container|viewport)|style|content|show\.ready/i,
  rrender = /^prerender|show\.ready/i;

PROTOTYPE.set = function(option, value) {
  if(this.destroyed) { return this; }

  var rendered = this.rendered,
    reposition = FALSE,
    options = this.options,
    checks = this.checks,
    name;

  // Convert singular option/value pair into object form
  if('string' === typeof option) {
    name = option; option = {}; option[name] = value;
  }
  else { option = $.extend({}, option); }

  // Set all of the defined options to their new values
  $.each(option, function(notation, value) {
    if(!rendered && !rrender.test(notation)) {
      delete option[notation]; return;
    }

    // Set new obj value
    var obj = convertNotation(options, notation.toLowerCase()), previous;
    previous = obj[0][ obj[1] ];
    obj[0][ obj[1] ] = value && value.nodeType ? $(value) : value;

    // Also check if we need to reposition
    reposition = rmove.test(notation) || reposition;

    // Set the new params for the callback
    option[notation] = [obj[0], obj[1], value, previous];
  });

  // Re-sanitize options
  sanitizeOptions(options);

  /*
   * Execute any valid callbacks for the set options
   * Also set positioning flag so we don't get loads of redundant repositioning calls.
   */
  this.positioning = TRUE;
  $.each(option, $.proxy(setCallback, this));
  this.positioning = FALSE;

  // Update position if needed
  if(this.rendered && this.tooltip[0].offsetWidth > 0 && reposition) {
    this.reposition( options.position.target === 'mouse' ? NULL : this.cache.event );
  }

  return this;
};

;PROTOTYPE._update = function(content, element, reposition) {
  var self = this,
    cache = this.cache;

  // Make sure tooltip is rendered and content is defined. If not return
  if(!this.rendered || !content) { return FALSE; }

  // Use function to parse content
  if($.isFunction(content)) {
    content = content.call(this.elements.target, cache.event, this) || '';
  }

  // Handle deferred content
  if($.isFunction(content.then)) {
    cache.waiting = TRUE;
    return content.then(function(c) {
      cache.waiting = FALSE;
      return self._update(c, element, reposition);
    }, NULL, function(e) {
      return self._update(e, element, reposition);
    });
  }

  // If content is null... return false
  if(content === FALSE || (!content && content !== '')) { return FALSE; }

  // Append new content if its a DOM array and show it if hidden
  if(content.jquery && content.length > 0) {
    element.empty().append( content.css({ display: 'block' }) );
  }

  // Content is a regular string, insert the new content
  else { element.html(content); }

  // Ensure images have loaded...
  cache.waiting = TRUE;
  return element.imagesLoaded()
    .done(function(images) {
      cache.waiting = FALSE;

      // Reposition if rendered
      if(reposition !== FALSE && self.rendered && self.tooltip[0].offsetWidth > 0) {
        self.reposition(cache.event, !images.length);
      }
    })
    .promise();
};

PROTOTYPE._updateContent = function(content, reposition) {
  this._update(content, this.elements.content, reposition);
};

PROTOTYPE._updateTitle = function(content, reposition) {
  if(this._update(content, this.elements.title, reposition) === FALSE) {
    this._removeTitle(FALSE);
  }
};

PROTOTYPE._createTitle = function()
{
  var elements = this.elements,
    id = this._id+'-title';

  // Destroy previous title element, if present
  if(elements.titlebar) { this._removeTitle(); }

  // Create title bar and title elements
  elements.titlebar = $('<div />', {
    'class': NAMESPACE + '-titlebar ' + (this.options.style.widget ? createWidgetClass('header') : '')
  })
  .append(
    elements.title = $('<div />', {
      'id': id,
      'class': NAMESPACE + '-title',
      'aria-atomic': TRUE
    })
  )
  .insertBefore(elements.content)

  // Button-specific events
  .delegate('.qtip-close', 'mousedown keydown mouseup keyup mouseout', function(event) {
    $(this).toggleClass('ui-state-active ui-state-focus', event.type.substr(-4) === 'down');
  })
  .delegate('.qtip-close', 'mouseover mouseout', function(event){
    $(this).toggleClass('ui-state-hover', event.type === 'mouseover');
  });

  // Create button if enabled
  if(this.options.content.button) { this._createButton(); }
};

PROTOTYPE._removeTitle = function(reposition)
{
  var elements = this.elements;

  if(elements.title) {
    elements.titlebar.remove();
    elements.titlebar = elements.title = elements.button = NULL;

    // Reposition if enabled
    if(reposition !== FALSE) { this.reposition(); }
  }
};

;PROTOTYPE.reposition = function(event, effect) {
  if(!this.rendered || this.positioning || this.destroyed) { return this; }

  // Set positioning flag
  this.positioning = TRUE;

  var cache = this.cache,
    tooltip = this.tooltip,
    posOptions = this.options.position,
    target = posOptions.target,
    my = posOptions.my,
    at = posOptions.at,
    viewport = posOptions.viewport,
    container = posOptions.container,
    adjust = posOptions.adjust,
    method = adjust.method.split(' '),
    elemWidth = tooltip.outerWidth(FALSE),
    elemHeight = tooltip.outerHeight(FALSE),
    targetWidth = 0,
    targetHeight = 0,
    type = tooltip.css('position'),
    position = { left: 0, top: 0 },
    visible = tooltip[0].offsetWidth > 0,
    isScroll = event && event.type === 'scroll',
    win = $(window),
    doc = container[0].ownerDocument,
    mouse = this.mouse,
    pluginCalculations, offset;

  // Check if absolute position was passed
  if($.isArray(target) && target.length === 2) {
    // Force left top and set position
    at = { x: LEFT, y: TOP };
    position = { left: target[0], top: target[1] };
  }

  // Check if mouse was the target
  else if(target === 'mouse' && ((event && event.pageX) || cache.event.pageX)) {
    // Force left top to allow flipping
    at = { x: LEFT, y: TOP };

    // Use cached event if one isn't available for positioning
    event = mouse && mouse.pageX && (adjust.mouse || !event || !event.pageX) ? mouse :
      (event && (event.type === 'resize' || event.type === 'scroll') ? cache.event :
      event && event.pageX && event.type === 'mousemove' ? event :
      (!adjust.mouse || this.options.show.distance) && cache.origin && cache.origin.pageX ? cache.origin :
      event) || event || cache.event || mouse || {};

    // Calculate body and container offset and take them into account below
    if(type !== 'static') { position = container.offset(); }
    if(doc.body.offsetWidth !== (window.innerWidth || doc.documentElement.clientWidth)) { offset = $(doc.body).offset(); }

    // Use event coordinates for position
    position = {
      left: event.pageX - position.left + (offset && offset.left || 0),
      top: event.pageY - position.top + (offset && offset.top || 0)
    };

    // Scroll events are a pain, some browsers
    if(adjust.mouse && isScroll) {
      position.left -= mouse.scrollX - win.scrollLeft();
      position.top -= mouse.scrollY - win.scrollTop();
    }
  }

  // Target wasn't mouse or absolute...
  else {
    // Check if event targetting is being used
    if(target === 'event' && event && event.target && event.type !== 'scroll' && event.type !== 'resize') {
      cache.target = $(event.target);
    }
    else if(target !== 'event'){
      cache.target = $(target.jquery ? target : elements.target);
    }
    target = cache.target;

    // Parse the target into a jQuery object and make sure there's an element present
    target = $(target).eq(0);
    if(target.length === 0) { return this; }

    // Check if window or document is the target
    else if(target[0] === document || target[0] === window) {
      targetWidth = BROWSER.iOS ? window.innerWidth : target.width();
      targetHeight = BROWSER.iOS ? window.innerHeight : target.height();

      if(target[0] === window) {
        position = {
          top: (viewport || target).scrollTop(),
          left: (viewport || target).scrollLeft()
        };
      }
    }

    // Check if the target is an <AREA> element
    else if(PLUGINS.imagemap && target.is('area')) {
      pluginCalculations = PLUGINS.imagemap(this, target, at, PLUGINS.viewport ? method : FALSE);
    }

    // Check if the target is an SVG element
    else if(PLUGINS.svg && target[0].ownerSVGElement) {
      pluginCalculations = PLUGINS.svg(this, target, at, PLUGINS.viewport ? method : FALSE);
    }

    // Otherwise use regular jQuery methods
    else {
      targetWidth = target.outerWidth(FALSE);
      targetHeight = target.outerHeight(FALSE);
      position = target.offset();
    }

    // Parse returned plugin values into proper variables
    if(pluginCalculations) {
      targetWidth = pluginCalculations.width;
      targetHeight = pluginCalculations.height;
      offset = pluginCalculations.offset;
      position = pluginCalculations.position;
    }

    // Adjust position to take into account offset parents
    position = this.reposition.offset(target, position, container);

    // Adjust for position.fixed tooltips (and also iOS scroll bug in v3.2-4.0 & v4.3-4.3.2)
    if((BROWSER.iOS > 3.1 && BROWSER.iOS < 4.1) ||
      (BROWSER.iOS >= 4.3 && BROWSER.iOS < 4.33) ||
      (!BROWSER.iOS && type === 'fixed')
    ){
      position.left -= win.scrollLeft();
      position.top -= win.scrollTop();
    }

    // Adjust position relative to target
    if(!pluginCalculations || (pluginCalculations && pluginCalculations.adjustable !== FALSE)) {
      position.left += at.x === RIGHT ? targetWidth : at.x === CENTER ? targetWidth / 2 : 0;
      position.top += at.y === BOTTOM ? targetHeight : at.y === CENTER ? targetHeight / 2 : 0;
    }
  }

  // Adjust position relative to tooltip
  position.left += adjust.x + (my.x === RIGHT ? -elemWidth : my.x === CENTER ? -elemWidth / 2 : 0);
  position.top += adjust.y + (my.y === BOTTOM ? -elemHeight : my.y === CENTER ? -elemHeight / 2 : 0);

  // Use viewport adjustment plugin if enabled
  if(PLUGINS.viewport) {
    position.adjusted = PLUGINS.viewport(
      this, position, posOptions, targetWidth, targetHeight, elemWidth, elemHeight
    );

    // Apply offsets supplied by positioning plugin (if used)
    if(offset && position.adjusted.left) { position.left += offset.left; }
    if(offset && position.adjusted.top) {  position.top += offset.top; }
  }

  // Viewport adjustment is disabled, set values to zero
  else { position.adjusted = { left: 0, top: 0 }; }

  // tooltipmove event
  if(!this._trigger('move', [position, viewport.elem || viewport], event)) { return this; }
  delete position.adjusted;

  // If effect is disabled, target it mouse, no animation is defined or positioning gives NaN out, set CSS directly
  if(effect === FALSE || !visible || isNaN(position.left) || isNaN(position.top) || target === 'mouse' || !$.isFunction(posOptions.effect)) {
    tooltip.css(position);
  }

  // Use custom function if provided
  else if($.isFunction(posOptions.effect)) {
    posOptions.effect.call(tooltip, this, $.extend({}, position));
    tooltip.queue(function(next) {
      // Reset attributes to avoid cross-browser rendering bugs
      $(this).css({ opacity: '', height: '' });
      if(BROWSER.ie) { this.style.removeAttribute('filter'); }

      next();
    });
  }

  // Set positioning flag
  this.positioning = FALSE;

  return this;
};

// Custom (more correct for qTip!) offset calculator
PROTOTYPE.reposition.offset = function(elem, pos, container) {
  if(!container[0]) { return pos; }

  var ownerDocument = $(elem[0].ownerDocument),
    quirks = !!BROWSER.ie && document.compatMode !== 'CSS1Compat',
    parent = container[0],
    scrolled, position, parentOffset, overflow;

  function scroll(e, i) {
    pos.left += i * e.scrollLeft();
    pos.top += i * e.scrollTop();
  }

  // Compensate for non-static containers offset
  do {
    if((position = $.css(parent, 'position')) !== 'static') {
      if(position === 'fixed') {
        parentOffset = parent.getBoundingClientRect();
        scroll(ownerDocument, -1);
      }
      else {
        parentOffset = $(parent).position();
        parentOffset.left += (parseFloat($.css(parent, 'borderLeftWidth')) || 0);
        parentOffset.top += (parseFloat($.css(parent, 'borderTopWidth')) || 0);
      }

      pos.left -= parentOffset.left + (parseFloat($.css(parent, 'marginLeft')) || 0);
      pos.top -= parentOffset.top + (parseFloat($.css(parent, 'marginTop')) || 0);

      // If this is the first parent element with an overflow of "scroll" or "auto", store it
      if(!scrolled && (overflow = $.css(parent, 'overflow')) !== 'hidden' && overflow !== 'visible') { scrolled = $(parent); }
    }
  }
  while((parent = parent.offsetParent));

  // Compensate for containers scroll if it also has an offsetParent (or in IE quirks mode)
  if(scrolled && (scrolled[0] !== ownerDocument[0] || quirks)) {
    scroll(scrolled, 1);
  }

  return pos;
};

// Corner class
var C = (CORNER = PROTOTYPE.reposition.Corner = function(corner, forceY) {
  corner = ('' + corner).replace(/([A-Z])/, ' $1').replace(/middle/gi, CENTER).toLowerCase();
  this.x = (corner.match(/left|right/i) || corner.match(/center/) || ['inherit'])[0].toLowerCase();
  this.y = (corner.match(/top|bottom|center/i) || ['inherit'])[0].toLowerCase();
  this.forceY = !!forceY;

  var f = corner.charAt(0);
  this.precedance = (f === 't' || f === 'b' ? Y : X);
}).prototype;

C.invert = function(z, center) {
  this[z] = this[z] === LEFT ? RIGHT : this[z] === RIGHT ? LEFT : center || this[z];
};

C.string = function() {
  var x = this.x, y = this.y;
  return x === y ? x : this.precedance === Y || (this.forceY && y !== 'center') ? y+' '+x : x+' '+y;
};

C.abbrev = function() {
  var result = this.string().split(' ');
  return result[0].charAt(0) + (result[1] && result[1].charAt(0) || '');
};

C.clone = function() {
  return new CORNER( this.string(), this.forceY );
};;
PROTOTYPE.toggle = function(state, event) {
  var cache = this.cache,
    options = this.options,
    tooltip = this.tooltip;

  // Try to prevent flickering when tooltip overlaps show element
  if(event) {
    if((/over|enter/).test(event.type) && (/out|leave/).test(cache.event.type) &&
      options.show.target.add(event.target).length === options.show.target.length &&
      tooltip.has(event.relatedTarget).length) {
      return this;
    }

    // Cache event
    cache.event = $.extend({}, event);
  }

  // If we're currently waiting and we've just hidden... stop it
  this.waiting && !state && (this.hiddenDuringWait = TRUE);

  // Render the tooltip if showing and it isn't already
  if(!this.rendered) { return state ? this.render(1) : this; }
  else if(this.destroyed || this.disabled) { return this; }

  var type = state ? 'show' : 'hide',
    opts = this.options[type],
    otherOpts = this.options[ !state ? 'show' : 'hide' ],
    posOptions = this.options.position,
    contentOptions = this.options.content,
    width = this.tooltip.css('width'),
    visible = this.tooltip[0].offsetWidth > 0,
    animate = state || opts.target.length === 1,
    sameTarget = !event || opts.target.length < 2 || cache.target[0] === event.target,
    identicalState, allow, showEvent, delay;

  // Detect state if valid one isn't provided
  if((typeof state).search('boolean|number')) { state = !visible; }

  // Check if the tooltip is in an identical state to the new would-be state
  identicalState = !tooltip.is(':animated') && visible === state && sameTarget;

  // Fire tooltip(show/hide) event and check if destroyed
  allow = !identicalState ? !!this._trigger(type, [90]) : NULL;

  // If the user didn't stop the method prematurely and we're showing the tooltip, focus it
  if(allow !== FALSE && state) { this.focus(event); }

  // If the state hasn't changed or the user stopped it, return early
  if(!allow || identicalState) { return this; }

  // Set ARIA hidden attribute
  $.attr(tooltip[0], 'aria-hidden', !!!state);

  // Execute state specific properties
  if(state) {
    // Store show origin coordinates
    cache.origin = $.extend({}, this.mouse);

    // Update tooltip content & title if it's a dynamic function
    if($.isFunction(contentOptions.text)) { this._updateContent(contentOptions.text, FALSE); }
    if($.isFunction(contentOptions.title)) { this._updateTitle(contentOptions.title, FALSE); }

    // Cache mousemove events for positioning purposes (if not already tracking)
    if(!trackingBound && posOptions.target === 'mouse' && posOptions.adjust.mouse) {
      $(document).bind('mousemove.'+NAMESPACE, this._storeMouse);
      trackingBound = TRUE;
    }

    // Update the tooltip position (set width first to prevent viewport/max-width issues)
    if(!width) { tooltip.css('width', tooltip.outerWidth(FALSE)); }
    this.reposition(event, arguments[2]);
    if(!width) { tooltip.css('width', ''); }

    // Hide other tooltips if tooltip is solo
    if(!!opts.solo) {
      (typeof opts.solo === 'string' ? $(opts.solo) : $(SELECTOR, opts.solo))
        .not(tooltip).not(opts.target).qtip('hide', $.Event('tooltipsolo'));
    }
  }
  else {
    // Clear show timer if we're hiding
    clearTimeout(this.timers.show);

    // Remove cached origin on hide
    delete cache.origin;

    // Remove mouse tracking event if not needed (all tracking qTips are hidden)
    if(trackingBound && !$(SELECTOR+'[tracking="true"]:visible', opts.solo).not(tooltip).length) {
      $(document).unbind('mousemove.'+NAMESPACE);
      trackingBound = FALSE;
    }

    // Blur the tooltip
    this.blur(event);
  }

  // Define post-animation, state specific properties
  after = $.proxy(function() {
    if(state) {
      // Prevent antialias from disappearing in IE by removing filter
      if(BROWSER.ie) { tooltip[0].style.removeAttribute('filter'); }

      // Remove overflow setting to prevent tip bugs
      tooltip.css('overflow', '');

      // Autofocus elements if enabled
      if('string' === typeof opts.autofocus) {
        $(this.options.show.autofocus, tooltip).focus();
      }

      // If set, hide tooltip when inactive for delay period
      this.options.show.target.trigger('qtip-'+this.id+'-inactive');
    }
    else {
      // Reset CSS states
      tooltip.css({
        display: '',
        visibility: '',
        opacity: '',
        left: '',
        top: ''
      });
    }

    // tooltipvisible/tooltiphidden events
    this._trigger(state ? 'visible' : 'hidden');
  }, this);

  // If no effect type is supplied, use a simple toggle
  if(opts.effect === FALSE || animate === FALSE) {
    tooltip[ type ]();
    after();
  }

  // Use custom function if provided
  else if($.isFunction(opts.effect)) {
    tooltip.stop(1, 1);
    opts.effect.call(tooltip, this);
    tooltip.queue('fx', function(n) {
      after(); n();
    });
  }

  // Use basic fade function by default
  else { tooltip.fadeTo(90, state ? 1 : 0, after); }

  // If inactive hide method is set, active it
  if(state) { opts.target.trigger('qtip-'+this.id+'-inactive'); }

  return this;
};

PROTOTYPE.show = function(event) { return this.toggle(TRUE, event); };

PROTOTYPE.hide = function(event) { return this.toggle(FALSE, event); };

;PROTOTYPE.focus = function(event) {
  if(!this.rendered || this.destroyed) { return this; }

  var qtips = $(SELECTOR),
    tooltip = this.tooltip,
    curIndex = parseInt(tooltip[0].style.zIndex, 10),
    newIndex = QTIP.zindex + qtips.length,
    focusedElem;

  // Only update the z-index if it has changed and tooltip is not already focused
  if(!tooltip.hasClass(CLASS_FOCUS)) {
    // tooltipfocus event
    if(this._trigger('focus', [newIndex], event)) {
      // Only update z-index's if they've changed
      if(curIndex !== newIndex) {
        // Reduce our z-index's and keep them properly ordered
        qtips.each(function() {
          if(this.style.zIndex > curIndex) {
            this.style.zIndex = this.style.zIndex - 1;
          }
        });

        // Fire blur event for focused tooltip
        qtips.filter('.' + CLASS_FOCUS).qtip('blur', event);
      }

      // Set the new z-index
      tooltip.addClass(CLASS_FOCUS)[0].style.zIndex = newIndex;
    }
  }

  return this;
};

PROTOTYPE.blur = function(event) {
  if(!this.rendered || this.destroyed) { return this; }

  // Set focused status to FALSE
  this.tooltip.removeClass(CLASS_FOCUS);

  // tooltipblur event
  this._trigger('blur', [ this.tooltip.css('zIndex') ], event);

  return this;
};

;PROTOTYPE.disable = function(state) {
  if(this.destroyed) { return this; }

  if('boolean' !== typeof state) {
    state = !(this.tooltip.hasClass(CLASS_DISABLED) || this.disabled);
  }

  if(this.rendered) {
    this.tooltip.toggleClass(CLASS_DISABLED, state)
      .attr('aria-disabled', state);
  }

  this.disabled = !!state;

  return this;
};

PROTOTYPE.enable = function() { return this.disable(FALSE); };

;PROTOTYPE._createButton = function()
{
  var self = this,
    elements = this.elements,
    tooltip = elements.tooltip,
    button = this.options.content.button,
    isString = typeof button === 'string',
    close = isString ? button : 'Close tooltip';

  if(elements.button) { elements.button.remove(); }

  // Use custom button if one was supplied by user, else use default
  if(button.jquery) {
    elements.button = button;
  }
  else {
    elements.button = $('<a />', {
      'class': 'qtip-close ' + (this.options.style.widget ? '' : NAMESPACE+'-icon'),
      'title': close,
      'aria-label': close
    })
    .prepend(
      $('<span />', {
        'class': 'ui-icon ui-icon-close',
        'html': '&times;'
      })
    );
  }

  // Create button and setup attributes
  elements.button.appendTo(elements.titlebar || tooltip)
    .attr('role', 'button')
    .click(function(event) {
      if(!tooltip.hasClass(CLASS_DISABLED)) { self.hide(event); }
      return FALSE;
    });
};

PROTOTYPE._updateButton = function(button)
{
  // Make sure tooltip is rendered and if not, return
  if(!this.rendered) { return FALSE; }

  var elem = this.elements.button;
  if(button) { this._createButton(); }
  else { elem.remove(); }
};

;// Widget class creator
function createWidgetClass(cls) {
  return WIDGET.concat('').join(cls ? '-'+cls+' ' : ' ');
}

// Widget class setter method
PROTOTYPE._setWidget = function()
{
  var on = this.options.style.widget,
    elements = this.elements,
    tooltip = elements.tooltip,
    disabled = tooltip.hasClass(CLASS_DISABLED);

  tooltip.removeClass(CLASS_DISABLED);
  CLASS_DISABLED = on ? 'ui-state-disabled' : 'qtip-disabled';
  tooltip.toggleClass(CLASS_DISABLED, disabled);

  tooltip.toggleClass('ui-helper-reset '+createWidgetClass(), on).toggleClass(CLASS_DEFAULT, this.options.style.def && !on);

  if(elements.content) {
    elements.content.toggleClass( createWidgetClass('content'), on);
  }
  if(elements.titlebar) {
    elements.titlebar.toggleClass( createWidgetClass('header'), on);
  }
  if(elements.button) {
    elements.button.toggleClass(NAMESPACE+'-icon', !on);
  }
};;function showMethod(event) {
  if(this.tooltip.hasClass(CLASS_DISABLED)) { return FALSE; }

  // Clear hide timers
  clearTimeout(this.timers.show);
  clearTimeout(this.timers.hide);

  // Start show timer
  var callback = $.proxy(function(){ this.toggle(TRUE, event); }, this);
  if(this.options.show.delay > 0) {
    this.timers.show = setTimeout(callback, this.options.show.delay);
  }
  else{ callback(); }
}

function hideMethod(event) {
  if(this.tooltip.hasClass(CLASS_DISABLED)) { return FALSE; }

  // Check if new target was actually the tooltip element
  var relatedTarget = $(event.relatedTarget),
    ontoTooltip = relatedTarget.closest(SELECTOR)[0] === this.tooltip[0],
    ontoTarget = relatedTarget[0] === this.options.show.target[0];

  // Clear timers and stop animation queue
  clearTimeout(this.timers.show);
  clearTimeout(this.timers.hide);

  // Prevent hiding if tooltip is fixed and event target is the tooltip.
  // Or if mouse positioning is enabled and cursor momentarily overlaps
  if(this !== relatedTarget[0] &&
    (this.options.position.target === 'mouse' && ontoTooltip) ||
    (this.options.hide.fixed && (
      (/mouse(out|leave|move)/).test(event.type) && (ontoTooltip || ontoTarget))
    ))
  {
    try {
      event.preventDefault();
      event.stopImmediatePropagation();
    } catch(e) {}

    return;
  }

  // If tooltip has displayed, start hide timer
  var callback = $.proxy(function(){ this.toggle(FALSE, event); }, this);
  if(this.options.hide.delay > 0) {
    this.timers.hide = setTimeout(callback, this.options.hide.delay);
  }
  else{ callback(); }
}

function inactiveMethod(event) {
  if(this.tooltip.hasClass(CLASS_DISABLED) || !this.options.hide.inactive) { return FALSE; }

  // Clear timer
  clearTimeout(this.timers.inactive);
  this.timers.inactive = setTimeout(
    $.proxy(function(){ this.hide(event); }, this), this.options.hide.inactive
  );
}

function repositionMethod(event) {
  if(this.rendered && this.tooltip[0].offsetWidth > 0) { this.reposition(event); }
}

// Store mouse coordinates
PROTOTYPE._storeMouse = function(event) {
  this.mouse = {
    pageX: event.pageX,
    pageY: event.pageY,
    type: 'mousemove',
    scrollX: window.pageXOffset || document.body.scrollLeft || document.documentElement.scrollLeft,
    scrollY: window.pageYOffset || document.body.scrollTop || document.documentElement.scrollTop
  };
};

// Bind events
PROTOTYPE._bind = function(targets, events, method, suffix, context) {
  var ns = '.' + this._id + (suffix ? '-'+suffix : '');
  events.length && $(targets).bind(
    (events.split ? events : events.join(ns + ' ')) + ns,
    $.proxy(method, context || this)
  );
};
PROTOTYPE._unbind = function(targets, suffix) {
  $(targets).unbind('.' + this._id + (suffix ? '-'+suffix : ''));
};

// Apply common event handlers using delegate (avoids excessive .bind calls!)
var ns = '.'+NAMESPACE;
function delegate(selector, events, method) {
  $(document.body).delegate(selector,
    (events.split ? events : events.join(ns + ' ')) + ns,
    function() {
      var api = QTIP.api[ $.attr(this, ATTR_ID) ];
      api && !api.disabled && method.apply(api, arguments);
    }
  );
}

$(function() {
  delegate(SELECTOR, ['mouseenter', 'mouseleave'], function(event) {
    var state = event.type === 'mouseenter',
      tooltip = $(event.currentTarget),
      target = $(event.relatedTarget || event.target),
      options = this.options;

    // On mouseenter...
    if(state) {
      // Focus the tooltip on mouseenter (z-index stacking)
      this.focus(event);

      // Clear hide timer on tooltip hover to prevent it from closing
      tooltip.hasClass(CLASS_FIXED) && !tooltip.hasClass(CLASS_DISABLED) && clearTimeout(this.timers.hide);
    }

    // On mouseleave...
    else {
      // Hide when we leave the tooltip and not onto the show target (if a hide event is set)
      if(options.position.target === 'mouse' && options.hide.event &&
        options.show.target && !target.closest(options.show.target[0]).length) {
        this.hide(event);
      }
    }

    // Add hover class
    tooltip.toggleClass(CLASS_HOVER, state);
  });

  // Define events which reset the 'inactive' event handler
  delegate('['+ATTR_ID+']', INACTIVE_EVENTS, inactiveMethod);
});

// Event trigger
PROTOTYPE._trigger = function(type, args, event) {
  var callback = $.Event('tooltip'+type);
  callback.originalEvent = (event && $.extend({}, event)) || this.cache.event || NULL;

  this.triggering = TRUE;
  this.tooltip.trigger(callback, [this].concat(args || []));
  this.triggering = FALSE;

  return !callback.isDefaultPrevented();
};

// Event assignment method
PROTOTYPE._assignEvents = function() {
  var options = this.options,
    posOptions = options.position,

    tooltip = this.tooltip,
    showTarget = options.show.target,
    hideTarget = options.hide.target,
    containerTarget = posOptions.container,
    viewportTarget = posOptions.viewport,
    documentTarget = $(document),
    bodyTarget = $(document.body),
    windowTarget = $(window),

    showEvents = options.show.event ? $.trim('' + options.show.event).split(' ') : [],
    hideEvents = options.hide.event ? $.trim('' + options.hide.event).split(' ') : [],
    toggleEvents = [];

  // Hide tooltips when leaving current window/frame (but not select/option elements)
  if(/mouse(out|leave)/i.test(options.hide.event) && options.hide.leave === 'window') {
    this._bind(documentTarget, ['mouseout', 'blur'], function(event) {
      if(!/select|option/.test(event.target.nodeName) && !event.relatedTarget) {
        this.hide(event);
      }
    });
  }

  // Enable hide.fixed by adding appropriate class
  if(options.hide.fixed) {
    hideTarget = hideTarget.add( tooltip.addClass(CLASS_FIXED) );
  }

  /*
   * Make sure hoverIntent functions properly by using mouseleave to clear show timer if
   * mouseenter/mouseout is used for show.event, even if it isn't in the users options.
   */
  else if(/mouse(over|enter)/i.test(options.show.event)) {
    this._bind(hideTarget, 'mouseleave', function() {
      clearTimeout(this.timers.show);
    });
  }

  // Hide tooltip on document mousedown if unfocus events are enabled
  if(('' + options.hide.event).indexOf('unfocus') > -1) {
    this._bind(containerTarget.closest('html'), ['mousedown', 'touchstart'], function(event) {
      var elem = $(event.target),
        enabled = this.rendered && !this.tooltip.hasClass(CLASS_DISABLED) && this.tooltip[0].offsetWidth > 0,
        isAncestor = elem.parents(SELECTOR).filter(this.tooltip[0]).length > 0;

      if(elem[0] !== this.target[0] && elem[0] !== this.tooltip[0] && !isAncestor &&
        !this.target.has(elem[0]).length && enabled
      ) {
        this.hide(event);
      }
    });
  }

  // Check if the tooltip hides when inactive
  if('number' === typeof options.hide.inactive) {
    // Bind inactive method to show target(s) as a custom event
    this._bind(showTarget, 'qtip-'+this.id+'-inactive', inactiveMethod);

    // Define events which reset the 'inactive' event handler
    this._bind(hideTarget.add(tooltip), QTIP.inactiveEvents, inactiveMethod, '-inactive');
  }

  // Apply hide events (and filter identical show events)
  hideEvents = $.map(hideEvents, function(type) {
    var showIndex = $.inArray(type, showEvents);

    // Both events and targets are identical, apply events using a toggle
    if((showIndex > -1 && hideTarget.add(showTarget).length === hideTarget.length)) {
      toggleEvents.push( showEvents.splice( showIndex, 1 )[0] ); return;
    }

    return type;
  });

  // Apply show/hide/toggle events
  this._bind(showTarget, showEvents, showMethod);
  this._bind(hideTarget, hideEvents, hideMethod);
  this._bind(showTarget, toggleEvents, function(event) {
    (this.tooltip[0].offsetWidth > 0 ? hideMethod : showMethod).call(this, event);
  });


  // Mouse movement bindings
  this._bind(showTarget.add(tooltip), 'mousemove', function(event) {
    // Check if the tooltip hides when mouse is moved a certain distance
    if('number' === typeof options.hide.distance) {
      var origin = this.cache.origin || {},
        limit = this.options.hide.distance,
        abs = Math.abs;

      // Check if the movement has gone beyond the limit, and hide it if so
      if(abs(event.pageX - origin.pageX) >= limit || abs(event.pageY - origin.pageY) >= limit) {
        this.hide(event);
      }
    }

    // Cache mousemove coords on show targets
    this._storeMouse(event);
  });

  // Mouse positioning events
  if(posOptions.target === 'mouse') {
    // If mouse adjustment is on...
    if(posOptions.adjust.mouse) {
      // Apply a mouseleave event so we don't get problems with overlapping
      if(options.hide.event) {
        // Track if we're on the target or not
        this._bind(showTarget, ['mouseenter', 'mouseleave'], function(event) {
          this.cache.onTarget = event.type === 'mouseenter';
        });
      }

      // Update tooltip position on mousemove
      this._bind(documentTarget, 'mousemove', function(event) {
        // Update the tooltip position only if the tooltip is visible and adjustment is enabled
        if(this.rendered && this.cache.onTarget && !this.tooltip.hasClass(CLASS_DISABLED) && this.tooltip[0].offsetWidth > 0) {
          this.reposition(event);
        }
      });
    }
  }

  // Adjust positions of the tooltip on window resize if enabled
  if(posOptions.adjust.resize || viewportTarget.length) {
    this._bind( $.event.special.resize ? viewportTarget : windowTarget, 'resize', repositionMethod );
  }

  // Adjust tooltip position on scroll of the window or viewport element if present
  if(posOptions.adjust.scroll) {
    this._bind( windowTarget.add(posOptions.container), 'scroll', repositionMethod );
  }
};

// Un-assignment method
PROTOTYPE._unassignEvents = function() {
  var targets = [
    this.options.show.target[0],
    this.options.hide.target[0],
    this.rendered && this.tooltip[0],
    this.options.position.container[0],
    this.options.position.viewport[0],
    this.options.position.container.closest('html')[0], // unfocus
    window,
    document
  ];

  // Check if tooltip is rendered
  if(this.rendered) {
    this._unbind($([]).pushStack( $.grep(targets, function(i) {
      return typeof i === 'object';
    })));
  }

  // Tooltip isn't yet rendered, remove render event
  else { $(targets[0]).unbind('.'+this._id+'-create'); }
};

;// Initialization method
function init(elem, id, opts)
{
  var obj, posOptions, attr, config, title,

  // Setup element references
  docBody = $(document.body),

  // Use document body instead of document element if needed
  newTarget = elem[0] === document ? docBody : elem,

  // Grab metadata from element if plugin is present
  metadata = (elem.metadata) ? elem.metadata(opts.metadata) : NULL,

  // If metadata type if HTML5, grab 'name' from the object instead, or use the regular data object otherwise
  metadata5 = opts.metadata.type === 'html5' && metadata ? metadata[opts.metadata.name] : NULL,

  // Grab data from metadata.name (or data-qtipopts as fallback) using .data() method,
  html5 = elem.data(opts.metadata.name || 'qtipopts');

  // If we don't get an object returned attempt to parse it manualyl without parseJSON
  try { html5 = typeof html5 === 'string' ? $.parseJSON(html5) : html5; } catch(e) {}

  // Merge in and sanitize metadata
  config = $.extend(TRUE, {}, QTIP.defaults, opts,
    typeof html5 === 'object' ? sanitizeOptions(html5) : NULL,
    sanitizeOptions(metadata5 || metadata));

  // Re-grab our positioning options now we've merged our metadata and set id to passed value
  posOptions = config.position;
  config.id = id;

  // Setup missing content if none is detected
  if('boolean' === typeof config.content.text) {
    attr = elem.attr(config.content.attr);

    // Grab from supplied attribute if available
    if(config.content.attr !== FALSE && attr) { config.content.text = attr; }

    // No valid content was found, abort render
    else { return FALSE; }
  }

  // Setup target options
  if(!posOptions.container.length) { posOptions.container = docBody; }
  if(posOptions.target === FALSE) { posOptions.target = newTarget; }
  if(config.show.target === FALSE) { config.show.target = newTarget; }
  if(config.show.solo === TRUE) { config.show.solo = posOptions.container.closest('body'); }
  if(config.hide.target === FALSE) { config.hide.target = newTarget; }
  if(config.position.viewport === TRUE) { config.position.viewport = posOptions.container; }

  // Ensure we only use a single container
  posOptions.container = posOptions.container.eq(0);

  // Convert position corner values into x and y strings
  posOptions.at = new CORNER(posOptions.at, TRUE);
  posOptions.my = new CORNER(posOptions.my);

  // Destroy previous tooltip if overwrite is enabled, or skip element if not
  if(elem.data(NAMESPACE)) {
    if(config.overwrite) {
      elem.qtip('destroy');
    }
    else if(config.overwrite === FALSE) {
      return FALSE;
    }
  }

  // Add has-qtip attribute
  elem.attr(ATTR_HAS, id);

  // Remove title attribute and store it if present
  if(config.suppress && (title = elem.attr('title'))) {
    // Final attr call fixes event delegatiom and IE default tooltip showing problem
    elem.removeAttr('title').attr(oldtitle, title).attr('title', '');
  }

  // Initialize the tooltip and add API reference
  obj = new QTip(elem, config, id, !!attr);
  elem.data(NAMESPACE, obj);

  // Catch remove/removeqtip events on target element to destroy redundant tooltip
  elem.one('remove.qtip-'+id+' removeqtip.qtip-'+id, function() {
    var api; if((api = $(this).data(NAMESPACE))) { api.destroy(); }
  });

  return obj;
}

// jQuery $.fn extension method
QTIP = $.fn.qtip = function(options, notation, newValue)
{
  var command = ('' + options).toLowerCase(), // Parse command
    returned = NULL,
    args = $.makeArray(arguments).slice(1),
    event = args[args.length - 1],
    opts = this[0] ? $.data(this[0], NAMESPACE) : NULL;

  // Check for API request
  if((!arguments.length && opts) || command === 'api') {
    return opts;
  }

  // Execute API command if present
  else if('string' === typeof options)
  {
    this.each(function()
    {
      var api = $.data(this, NAMESPACE);
      if(!api) { return TRUE; }

      // Cache the event if possible
      if(event && event.timeStamp) { api.cache.event = event; }

      // Check for specific API commands
      if(notation && (command === 'option' || command === 'options')) {
        if(newValue !== undefined || $.isPlainObject(notation)) {
          api.set(notation, newValue);
        }
        else {
          returned = api.get(notation);
          return FALSE;
        }
      }

      // Execute API command
      else if(api[command]) {
        api[command].apply(api, args);
      }
    });

    return returned !== NULL ? returned : this;
  }

  // No API commands. validate provided options and setup qTips
  else if('object' === typeof options || !arguments.length)
  {
    opts = sanitizeOptions($.extend(TRUE, {}, options));

    // Bind the qTips
    return QTIP.bind.call(this, opts, event);
  }
};

// $.fn.qtip Bind method
QTIP.bind = function(opts, event)
{
  return this.each(function(i) {
    var options, targets, events, namespace, api, id;

    // Find next available ID, or use custom ID if provided
    id = $.isArray(opts.id) ? opts.id[i] : opts.id;
    id = !id || id === FALSE || id.length < 1 || QTIP.api[id] ? QTIP.nextid++ : id;

    // Setup events namespace
    namespace = '.qtip-'+id+'-create';

    // Initialize the qTip and re-grab newly sanitized options
    api = init($(this), id, opts);
    if(api === FALSE) { return TRUE; }
    else { QTIP.api[id] = api; }
    options = api.options;

    // Initialize plugins
    $.each(PLUGINS, function() {
      if(this.initialize === 'initialize') { this(api); }
    });

    // Determine hide and show targets
    targets = { show: options.show.target, hide: options.hide.target };
    events = {
      show: $.trim('' + options.show.event).replace(/ /g, namespace+' ') + namespace,
      hide: $.trim('' + options.hide.event).replace(/ /g, namespace+' ') + namespace
    };

    /*
     * Make sure hoverIntent functions properly by using mouseleave as a hide event if
     * mouseenter/mouseout is used for show.event, even if it isn't in the users options.
     */
    if(/mouse(over|enter)/i.test(events.show) && !/mouse(out|leave)/i.test(events.hide)) {
      events.hide += ' mouseleave' + namespace;
    }

    /*
     * Also make sure initial mouse targetting works correctly by caching mousemove coords
     * on show targets before the tooltip has rendered.
     *
     * Also set onTarget when triggered to keep mouse tracking working
     */
    targets.show.bind('mousemove'+namespace, function(event) {
      api._storeMouse(event);
      api.cache.onTarget = TRUE;
    });

    // Define hoverIntent function
    function hoverIntent(event) {
      function render() {
        // Cache mouse coords,render and render the tooltip
        api.render(typeof event === 'object' || options.show.ready);

        // Unbind show and hide events
        targets.show.add(targets.hide).unbind(namespace);
      }

      // Only continue if tooltip isn't disabled
      if(api.disabled) { return FALSE; }

      // Cache the event data
      api.cache.event = $.extend({}, event);
      api.cache.target = event ? $(event.target) : [undefined];

      // Start the event sequence
      if(options.show.delay > 0) {
        clearTimeout(api.timers.show);
        api.timers.show = setTimeout(render, options.show.delay);
        if(events.show !== events.hide) {
          targets.hide.bind(events.hide, function() { clearTimeout(api.timers.show); });
        }
      }
      else { render(); }
    }

    // Bind show events to target
    targets.show.bind(events.show, hoverIntent);

    // Prerendering is enabled, create tooltip now
    if(options.show.ready || options.prerender) { hoverIntent(event); }
  });
};

// Populated in render method
QTIP.api = {};
;$.each({
  /* Allow other plugins to successfully retrieve the title of an element with a qTip applied */
  attr: function(attr, val) {
    if(this.length) {
      var self = this[0],
        title = 'title',
        api = $.data(self, 'qtip');

      if(attr === title && api && 'object' === typeof api && api.options.suppress) {
        if(arguments.length < 2) {
          return $.attr(self, oldtitle);
        }

        // If qTip is rendered and title was originally used as content, update it
        if(api && api.options.content.attr === title && api.cache.attr) {
          api.set('content.text', val);
        }

        // Use the regular attr method to set, then cache the result
        return this.attr(oldtitle, val);
      }
    }

    return $.fn['attr'+replaceSuffix].apply(this, arguments);
  },

  /* Allow clone to correctly retrieve cached title attributes */
  clone: function(keepData) {
    var titles = $([]), title = 'title',

    // Clone our element using the real clone method
    elems = $.fn['clone'+replaceSuffix].apply(this, arguments);

    // Grab all elements with an oldtitle set, and change it to regular title attribute, if keepData is false
    if(!keepData) {
      elems.filter('['+oldtitle+']').attr('title', function() {
        return $.attr(this, oldtitle);
      })
      .removeAttr(oldtitle);
    }

    return elems;
  }
}, function(name, func) {
  if(!func || $.fn[name+replaceSuffix]) { return TRUE; }

  var old = $.fn[name+replaceSuffix] = $.fn[name];
  $.fn[name] = function() {
    return func.apply(this, arguments) || old.apply(this, arguments);
  };
});

/* Fire off 'removeqtip' handler in $.cleanData if jQuery UI not present (it already does similar).
 * This snippet is taken directly from jQuery UI source code found here:
 *     http://code.jquery.com/ui/jquery-ui-git.js
 */
if(!$.ui) {
  $['cleanData'+replaceSuffix] = $.cleanData;
  $.cleanData = function( elems ) {
    for(var i = 0, elem; (elem = $( elems[i] )).length && elem.attr(ATTR_ID); i++) {
      try { elem.triggerHandler('removeqtip'); }
      catch( e ) {}
    }
    $['cleanData'+replaceSuffix]( elems );
  };
}

;// qTip version
QTIP.version = '2.0.1-105';

// Base ID for all qTips
QTIP.nextid = 0;

// Inactive events array
QTIP.inactiveEvents = INACTIVE_EVENTS;

// Base z-index for all qTips
QTIP.zindex = 15000;

// Define configuration defaults
QTIP.defaults = {
  prerender: FALSE,
  id: FALSE,
  overwrite: TRUE,
  suppress: TRUE,
  content: {
    text: TRUE,
    attr: 'title',
    title: FALSE,
    button: FALSE
  },
  position: {
    my: 'top left',
    at: 'bottom right',
    target: FALSE,
    container: FALSE,
    viewport: FALSE,
    adjust: {
      x: 0, y: 0,
      mouse: TRUE,
      scroll: TRUE,
      resize: TRUE,
      method: 'flipinvert flipinvert'
    },
    effect: function(api, pos, viewport) {
      $(this).animate(pos, {
        duration: 200,
        queue: FALSE
      });
    }
  },
  show: {
    target: FALSE,
    event: 'mouseenter',
    effect: TRUE,
    delay: 90,
    solo: FALSE,
    ready: FALSE,
    autofocus: FALSE
  },
  hide: {
    target: FALSE,
    event: 'mouseleave',
    effect: TRUE,
    delay: 0,
    fixed: FALSE,
    inactive: FALSE,
    leave: 'window',
    distance: FALSE
  },
  style: {
    classes: '',
    widget: FALSE,
    width: FALSE,
    height: FALSE,
    def: TRUE
  },
  events: {
    render: NULL,
    move: NULL,
    show: NULL,
    hide: NULL,
    toggle: NULL,
    visible: NULL,
    hidden: NULL,
    focus: NULL,
    blur: NULL
  }
};

;var TIP,

// .bind()/.on() namespace
TIPNS = '.qtip-tip',

// Common CSS strings
MARGIN = 'margin',
BORDER = 'border',
COLOR = 'color',
BG_COLOR = 'background-color',
TRANSPARENT = 'transparent',
IMPORTANT = ' !important',

// Check if the browser supports <canvas/> elements
HASCANVAS = !!document.createElement('canvas').getContext,

// Invalid colour values used in parseColours()
INVALID = /rgba?\(0, 0, 0(, 0)?\)|transparent|#123456/i;

// Camel-case method, taken from jQuery source
// http://code.jquery.com/jquery-1.8.0.js
function camel(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/*
 * Modified from Modernizr's testPropsAll()
 * http://modernizr.com/downloads/modernizr-latest.js
 */
var cssProps = {}, cssPrefixes = ["Webkit", "O", "Moz", "ms"];
function vendorCss(elem, prop) {
  var ucProp = prop.charAt(0).toUpperCase() + prop.slice(1),
    props = (prop + ' ' + cssPrefixes.join(ucProp + ' ') + ucProp).split(' '),
    cur, val, i = 0;

  // If the property has already been mapped...
  if(cssProps[prop]) { return elem.css(cssProps[prop]); }

  while((cur = props[i++])) {
    if((val = elem.css(cur)) !== undefined) {
      return cssProps[prop] = cur, val;
    }
  }
}

// Parse a given elements CSS property into an int
function intCss(elem, prop) {
  return parseInt(vendorCss(elem, prop), 10);
}


// VML creation (for IE only)
if(!HASCANVAS) {
  createVML = function(tag, props, style) {
    return '<qtipvml:'+tag+' xmlns="urn:schemas-microsoft.com:vml" class="qtip-vml" '+(props||'')+
      ' style="behavior: url(#default#VML); '+(style||'')+ '" />';
  };
}



function Tip(qtip, options) {
  this._ns = 'tip';
  this.options = options;
  this.offset = options.offset;
  this.size = [ options.width, options.height ];

  // Initialize
  this.init( (this.qtip = qtip) );
}

$.extend(Tip.prototype, {
  init: function(qtip) {
    var context, tip;

    // Create tip element and prepend to the tooltip
    tip = this.element = qtip.elements.tip = $('<div />', { 'class': NAMESPACE+'-tip' }).prependTo(qtip.tooltip);

    // Create tip drawing element(s)
    if(HASCANVAS) {
      // save() as soon as we create the canvas element so FF2 doesn't bork on our first restore()!
      context = $('<canvas />').appendTo(this.element)[0].getContext('2d');

      // Setup constant parameters
      context.lineJoin = 'miter';
      context.miterLimit = 100;
      context.save();
    }
    else {
      context = createVML('shape', 'coordorigin="0,0"', 'position:absolute;');
      this.element.html(context + context);

      // Prevent mousing down on the tip since it causes problems with .live() handling in IE due to VML
      qtip._bind( $('*', tip).add(tip), ['click', 'mousedown'], function(event) { event.stopPropagation(); }, this._ns);
    }

    // Bind update events
    qtip._bind(qtip.tooltip, 'tooltipmove', this.reposition, this._ns, this);

    // Create it
    this.create();
  },

  _swapDimensions: function() {
    this.size[0] = this.options.height;
    this.size[1] = this.options.width;
  },
  _resetDimensions: function() {
    this.size[0] = this.options.width;
    this.size[1] = this.options.height;
  },

  _useTitle: function(corner) {
    var titlebar = this.qtip.elements.titlebar;
    return titlebar && (
      corner.y === TOP || (corner.y === CENTER && this.element.position().top + (size[1] / 2) + options.offset < titlebar.outerHeight(TRUE))
    );
  },

  _parseCorner: function(corner) {
    var my = this.qtip.options.position.my;

    // Detect corner and mimic properties
    if(corner === FALSE || my === FALSE) {
      corner = FALSE;
    }
    else if(corner === TRUE) {
      corner = new CORNER( my.string() );
    }
    else if(!corner.string) {
      corner = new CORNER(corner);
      corner.fixed = TRUE;
    }

    return corner;
  },

  _parseWidth: function(corner, side, use) {
    var elements = this.qtip.elements,
      prop = BORDER + camel(side) + 'Width';

    return (use ? intCss(use, prop) : (
      intCss(elements.content, prop) ||
      intCss(this._useTitle(corner) && elements.titlebar || elements.content, prop) ||
      intCss(tooltip, prop)
    )) || 0;
  },

  _parseRadius: function(corner) {
    var elements = this.qtip.elements,
      prop = BORDER + camel(corner.y) + camel(corner.x) + 'Radius';

    return BROWSER.ie < 9 ? 0 :
      intCss(this._useTitle(corner) && elements.titlebar || elements.content, prop) ||
      intCss(elements.tooltip, prop) || 0;
  },

  _invalidColour: function(elem, prop, compare) {
    var val = elem.css(prop);
    return !val || (compare && val === elem.css(compare)) || INVALID.test(val) ? FALSE : val;
  },

  _parseColours: function(corner) {
    var elements = this.qtip.elements,
      tip = this.element.css('cssText', ''),
      borderSide = BORDER + camel(corner[ corner.precedance ]) + camel(COLOR),
      colorElem = this._useTitle(corner) && elements.titlebar || elements.content,
      css = this._invalidColour, color = [];

    // Attempt to detect the background colour from various elements, left-to-right precedance
    color[0] = css(tip, BG_COLOR) || css(colorElem, BG_COLOR) || css(elements.content, BG_COLOR) ||
      css(tooltip, BG_COLOR) || tip.css(BG_COLOR);

    // Attempt to detect the correct border side colour from various elements, left-to-right precedance
    color[1] = css(tip, borderSide, COLOR) || css(colorElem, borderSide, COLOR) ||
      css(elements.content, borderSide, COLOR) || css(tooltip, borderSide, COLOR) || tooltip.css(borderSide);

    // Reset background and border colours
    $('*', tip).add(tip).css('cssText', BG_COLOR+':'+TRANSPARENT+IMPORTANT+';'+BORDER+':0'+IMPORTANT+';');

    return color;
  },

  _calculateSize: function(corner) {
    var y = corner.precedance === Y,
      width = this.options[ y ? 'height' : 'width' ],
      height = this.options[ y ? 'width' : 'height' ],
      isCenter = corner.abbrev() === 'c',
      base = width * (isCenter ? 0.5 : 1),
      pow = Math.pow,
      round = Math.round,
      bigHyp, ratio, result,

    smallHyp = Math.sqrt( pow(base, 2) + pow(height, 2) ),
    hyp = [ (this.border / base) * smallHyp, (this.border / height) * smallHyp ];

    hyp[2] = Math.sqrt( pow(hyp[0], 2) - pow(this.border, 2) );
    hyp[3] = Math.sqrt( pow(hyp[1], 2) - pow(this.border, 2) );

    bigHyp = smallHyp + hyp[2] + hyp[3] + (isCenter ? 0 : hyp[0]);
    ratio = bigHyp / smallHyp;

    result = [ round(ratio * width), round(ratio * height) ];

    return y ? result : result.reverse();
  },

  // Tip coordinates calculator
  _calculateTip: function(corner) {
    var width = this.size[0], height = this.size[1],
      width2 = Math.ceil(width / 2), height2 = Math.ceil(height / 2),

    // Define tip coordinates in terms of height and width values
    tips = {
      br: [0,0,   width,height, width,0],
      bl: [0,0,   width,0,    0,height],
      tr: [0,height,  width,0,    width,height],
      tl: [0,0,   0,height,   width,height],
      tc: [0,height,  width2,0,   width,height],
      bc: [0,0,   width,0,    width2,height],
      rc: [0,0,   width,height2,  0,height],
      lc: [width,0, width,height, 0,height2]
    };

    // Set common side shapes
    tips.lt = tips.br; tips.rt = tips.bl;
    tips.lb = tips.tr; tips.rb = tips.tl;

    return tips[ corner.abbrev() ];
  },

  create: function() {
    // Determine tip corner
    var c = this.corner = (HASCANVAS || BROWSER.ie) && this._parseCorner(this.options.corner);

    // If we have a tip corner...
    if( (this.enabled = !!this.corner && this.corner.abbrev() !== 'c') ) {
      // Cache it
      this.qtip.cache.corner = c.clone();

      // Create it
      this.update();
    }

    // Toggle tip element
    this.element.toggle(this.enabled);

    return this.corner;
  },

  update: function(corner, position) {
    if(!this.enabled) { return this; }

    var elements = this.qtip.elements,
      tip = this.element,
      inner = tip.children(),
      options = this.options,
      size = this.size,
      mimic = options.mimic,
      round = Math.round,
      color, precedance, context,
      coords, translate, newSize, border;

    // Re-determine tip if not already set
    if(!corner) { corner = this.qtip.cache.corner || this.corner; }

    // Use corner property if we detect an invalid mimic value
    if(mimic === FALSE) { mimic = corner; }

    // Otherwise inherit mimic properties from the corner object as necessary
    else {
      mimic = new CORNER(mimic);
      mimic.precedance = corner.precedance;

      if(mimic.x === 'inherit') { mimic.x = corner.x; }
      else if(mimic.y === 'inherit') { mimic.y = corner.y; }
      else if(mimic.x === mimic.y) {
        mimic[ corner.precedance ] = corner[ corner.precedance ];
      }
    }
    precedance = mimic.precedance;

    // Ensure the tip width.height are relative to the tip position
    if(corner.precedance === X) { this._swapDimensions(); }
    else { this._resetDimensions(); }

    // Update our colours
    color = this.color = this._parseColours(corner);

    // Detect border width, taking into account colours
    if(color[1] !== TRANSPARENT) {
      // Grab border width
      border = this.border = this._parseWidth(corner, corner[corner.precedance]);

      // If border width isn't zero, use border color as fill (1.0 style tips)
      if(options.border && border < 1) { color[0] = color[1]; }

      // Set border width (use detected border width if options.border is true)
      this.border = border = options.border !== TRUE ? options.border : border;
    }

    // Border colour was invalid, set border to zero
    else { this.border = border = 0; }

    // Calculate coordinates
    coords = this._calculateTip(mimic);

    // Determine tip size
    newSize = this.size = this._calculateSize(corner);
    tip.css({
      width: newSize[0],
      height: newSize[1],
      lineHeight: newSize[1]+'px'
    });

    // Calculate tip translation
    if(corner.precedance === Y) {
      translate = [
        round(mimic.x === LEFT ? border : mimic.x === RIGHT ? newSize[0] - size[0] - border : (newSize[0] - size[0]) / 2),
        round(mimic.y === TOP ? newSize[1] - size[1] : 0)
      ];
    }
    else {
      translate = [
        round(mimic.x === LEFT ? newSize[0] - size[0] : 0),
        round(mimic.y === TOP ? border : mimic.y === BOTTOM ? newSize[1] - size[1] - border : (newSize[1] - size[1]) / 2)
      ];
    }

    // Canvas drawing implementation
    if(HASCANVAS) {
      // Set the canvas size using calculated size
      inner.attr(WIDTH, newSize[0]).attr(HEIGHT, newSize[1]);

      // Grab canvas context and clear/save it
      context = inner[0].getContext('2d');
      context.restore(); context.save();
      context.clearRect(0,0,3000,3000);

      // Set properties
      context.fillStyle = color[0];
      context.strokeStyle = color[1];
      context.lineWidth = border * 2;

      // Draw the tip
      context.translate(translate[0], translate[1]);
      context.beginPath();
      context.moveTo(coords[0], coords[1]);
      context.lineTo(coords[2], coords[3]);
      context.lineTo(coords[4], coords[5]);
      context.closePath();

      // Apply fill and border
      if(border) {
        // Make sure transparent borders are supported by doing a stroke
        // of the background colour before the stroke colour
        if(tooltip.css('background-clip') === 'border-box') {
          context.strokeStyle = color[0];
          context.stroke();
        }
        context.strokeStyle = color[1];
        context.stroke();
      }
      context.fill();
    }

    // VML (IE Proprietary implementation)
    else {
      // Setup coordinates string
      coords = 'm' + coords[0] + ',' + coords[1] + ' l' + coords[2] +
        ',' + coords[3] + ' ' + coords[4] + ',' + coords[5] + ' xe';

      // Setup VML-specific offset for pixel-perfection
      translate[2] = border && /^(r|b)/i.test(corner.string()) ?
        BROWSER.ie === 8 ? 2 : 1 : 0;

      // Set initial CSS
      inner.css({
        coordsize: (size[0]+border) + ' ' + (size[1]+border),
        antialias: ''+(mimic.string().indexOf(CENTER) > -1),
        left: translate[0],
        top: translate[1],
        width: size[0] + border,
        height: size[1] + border
      })
      .each(function(i) {
        var $this = $(this);

        // Set shape specific attributes
        $this[ $this.prop ? 'prop' : 'attr' ]({
          coordsize: (size[0]+border) + ' ' + (size[1]+border),
          path: coords,
          fillcolor: color[0],
          filled: !!i,
          stroked: !i
        })
        .toggle(!!(border || i));

        // Check if border is enabled and add stroke element
        !i && $this.html( createVML(
          'stroke', 'weight="'+(border*2)+'px" color="'+color[1]+'" miterlimit="1000" joinstyle="miter"'
        ) );
      });
    }

    // Position if needed
    if(position !== FALSE) { this.calculate(corner); }
  },

  calculate: function(corner) {
    if(!this.enabled) { return FALSE; }

    var self = this,
      elements = this.qtip.elements,
      tip = this.element,
      userOffset = Math.max(0, this.options.offset),
      isWidget = this.qtip.tooltip.hasClass('ui-widget'),
      position = {  },
      precedance, size, corners;

    // Inherit corner if not provided
    corner = corner || this.corner;
    precedance = corner.precedance;

    // Determine which tip dimension to use for adjustment
    size = this._calculateSize(corner);

    // Setup corners and offset array
    corners = [ corner.x, corner.y ];
    if(precedance === X) { corners.reverse(); }

    // Calculate tip position
    $.each(corners, function(i, side) {
      var b, bc, br;

      if(side === CENTER) {
        b = precedance === Y ? LEFT : TOP;
        position[ b ] = '50%';
        position[MARGIN+'-' + b] = -Math.round(size[ precedance === Y ? 0 : 1 ] / 2) + userOffset;
      }
      else {
        b = self._parseWidth(corner, side, elements.tooltip);
        bc = self._parseWidth(corner, side, elements.content);
        br = self._parseRadius(corner);

        position[ side ] = Math.max(-self.border, i ? bc : (userOffset + (br > b ? br : -b)));
      }
    });

    // Adjust for tip size
    position[ corner[precedance] ] -= size[ precedance === X ? 0 : 1 ];

    // Set and return new position
    tip.css({ margin: '', top: '', bottom: '', left: '', right: '' }).css(position);
    return position;
  },

  reposition: function(event, api, pos, viewport) {
    if(!this.enabled) { return; }

    var cache = api.cache,
      newCorner = this.corner.clone(),
      adjust = pos.adjusted,
      method = api.options.position.adjust.method.split(' '),
      horizontal = method[0],
      vertical = method[1] || method[0],
      shift = { left: FALSE, top: FALSE, x: 0, y: 0 },
      offset, css = {}, props;

    // If our tip position isn't fixed e.g. doesn't adjust with viewport...
    if(this.corner.fixed !== TRUE) {
      // Horizontal - Shift or flip method
      if(horizontal === SHIFT && newCorner.precedance === X && adjust.left && newCorner.y !== CENTER) {
        newCorner.precedance = newCorner.precedance === X ? Y : X;
      }
      else if(horizontal !== SHIFT && adjust.left){
        newCorner.x = newCorner.x === CENTER ? (adjust.left > 0 ? LEFT : RIGHT) : (newCorner.x === LEFT ? RIGHT : LEFT);
      }

      // Vertical - Shift or flip method
      if(vertical === SHIFT && newCorner.precedance === Y && adjust.top && newCorner.x !== CENTER) {
        newCorner.precedance = newCorner.precedance === Y ? X : Y;
      }
      else if(vertical !== SHIFT && adjust.top) {
        newCorner.y = newCorner.y === CENTER ? (adjust.top > 0 ? TOP : BOTTOM) : (newCorner.y === TOP ? BOTTOM : TOP);
      }

      // Update and redraw the tip if needed (check cached details of last drawn tip)
      if(newCorner.string() !== cache.corner.string() && (cache.cornerTop !== adjust.top || cache.cornerLeft !== adjust.left)) {
        this.update(newCorner, FALSE);
      }
    }

    // Setup tip offset properties
    offset = this.calculate(newCorner, adjust);

    // Readjust offset object to make it left/top
    if(offset.right !== undefined) { offset.left = -offset.right; }
    if(offset.bottom !== undefined) { offset.top = -offset.bottom; }
    offset.user = Math.max(0, this.offset);

    // Viewport "shift" specific adjustments
    if(shift.left = (horizontal === SHIFT && !!adjust.left)) {
      if(newCorner.x === CENTER) {
        css[MARGIN+'-left'] = shift.x = offset[MARGIN+'-left'] - adjust.left;
      }
      else {
        props = offset.right !== undefined ?
          [ adjust.left, -offset.left ] : [ -adjust.left, offset.left ];

        if( (shift.x = Math.max(props[0], props[1])) > props[0] ) {
          pos.left -= adjust.left;
          shift.left = FALSE;
        }

        css[ offset.right !== undefined ? RIGHT : LEFT ] = shift.x;
      }
    }
    if(shift.top = (vertical === SHIFT && !!adjust.top)) {
      if(newCorner.y === CENTER) {
        css[MARGIN+'-top'] = shift.y = offset[MARGIN+'-top'] - adjust.top;
      }
      else {
        props = offset.bottom !== undefined ?
          [ adjust.top, -offset.top ] : [ -adjust.top, offset.top ];

        if( (shift.y = Math.max(props[0], props[1])) > props[0] ) {
          pos.top -= adjust.top;
          shift.top = FALSE;
        }

        css[ offset.bottom !== undefined ? BOTTOM : TOP ] = shift.y;
      }
    }

    /*
    * If the tip is adjusted in both dimensions, or in a
    * direction that would cause it to be anywhere but the
    * outer border, hide it!
    */
    this.element.css(css).toggle(
      !((shift.x && shift.y) || (newCorner.x === CENTER && shift.y) || (newCorner.y === CENTER && shift.x))
    );

    // Adjust position to accomodate tip dimensions
    pos.left -= offset.left.charAt ? offset.user : horizontal !== SHIFT || shift.top || !shift.left && !shift.top ? offset.left : 0;
    pos.top -= offset.top.charAt ? offset.user : vertical !== SHIFT || shift.left || !shift.left && !shift.top ? offset.top : 0;

    // Cache details
    cache.cornerLeft = adjust.left; cache.cornerTop = adjust.top;
    cache.corner = newCorner.clone();
  },

  destroy: function() {
    // Unbind events
    this.qtip._unbind(this.qtip.tooltip, this._ns);

    // Remove the tip element(s)
    if(this.qtip.elements.tip) {
      this.qtip.elements.tip.find('*')
        .remove().end().remove();
    }
  }
});

TIP = PLUGINS.tip = function(api) {
  return new Tip(api, api.options.style.tip);
};

// Initialize tip on render
TIP.initialize = 'render';

// Setup plugin sanitization options
TIP.sanitize = function(options) {
  if(options.style && 'tip' in options.style) {
    opts = options.style.tip;
    if(typeof opts !== 'object') { opts = options.style.tip = { corner: opts }; }
    if(!(/string|boolean/i).test(typeof opts.corner)) { opts.corner = TRUE; }
  }
};

// Add new option checks for the plugin
CHECKS.tip = {
  '^position.my|style.tip.(corner|mimic|border)$': function() {
    // Make sure a tip can be drawn
    this.create();

    // Reposition the tooltip
    this.qtip.reposition();
  },
  '^style.tip.(height|width)$': function(obj) {
    // Re-set dimensions and redraw the tip
    this.size = size = [ obj.width, obj.height ];
    this.update();

    // Reposition the tooltip
    this.qtip.reposition();
  },
  '^content.title|style.(classes|widget)$': function() {
    this.update();
  }
};

// Extend original qTip defaults
$.extend(TRUE, QTIP.defaults, {
  style: {
    tip: {
      corner: TRUE,
      mimic: FALSE,
      width: 6,
      height: 6,
      border: TRUE,
      offset: 0
    }
  }
});

;var MODAL, OVERLAY,
  MODALCLASS = 'qtip-modal',
  MODALSELECTOR = '.'+MODALCLASS;

OVERLAY = function()
{
  var self = this,
    focusableElems = {},
    current, onLast,
    prevState, elem;

  // Modified code from jQuery UI 1.10.0 source
  // http://code.jquery.com/ui/1.10.0/jquery-ui.js
  function focusable(element) {
    // Use the defined focusable checker when possible
    if($.expr[':'].focusable) { return $.expr[':'].focusable; }

    var isTabIndexNotNaN = !isNaN($.attr(element, 'tabindex')),
      nodeName = element.nodeName && element.nodeName.toLowerCase(),
      map, mapName, img;

    if('area' === nodeName) {
      map = element.parentNode;
      mapName = map.name;
      if(!element.href || !mapName || map.nodeName.toLowerCase() !== 'map') {
        return false;
      }
      img = $('img[usemap=#' + mapName + ']')[0];
      return !!img && img.is(':visible');
    }
    return (/input|select|textarea|button|object/.test( nodeName ) ?
        !element.disabled :
        'a' === nodeName ?
          element.href || isTabIndexNotNaN :
          isTabIndexNotNaN
      );
  }

  // Focus inputs using cached focusable elements (see update())
  function focusInputs(blurElems) {
    // Blurring body element in IE causes window.open windows to unfocus!
    if(focusableElems.length < 1 && blurElems.length) { blurElems.not('body').blur(); }

    // Focus the inputs
    else { focusableElems.first().focus(); }
  }

  // Steal focus from elements outside tooltip
  function stealFocus(event) {
    if(!elem.is(':visible')) { return; }

    var target = $(event.target),
      tooltip = current.tooltip,
      container = target.closest(SELECTOR),
      targetOnTop;

    // Determine if input container target is above this
    targetOnTop = container.length < 1 ? FALSE :
      (parseInt(container[0].style.zIndex, 10) > parseInt(tooltip[0].style.zIndex, 10));

    // If we're showing a modal, but focus has landed on an input below
    // this modal, divert focus to the first visible input in this modal
    // or if we can't find one... the tooltip itself
    if(!targetOnTop && target.closest(SELECTOR)[0] !== tooltip[0]) {
      focusInputs(target);
    }

    // Detect when we leave the last focusable element...
    onLast = event.target === focusableElems[focusableElems.length - 1];
  }

  $.extend(self, {
    init: function() {
      // Create document overlay
      elem = self.elem = $('<div />', {
        id: 'qtip-overlay',
        html: '<div></div>',
        mousedown: function() { return FALSE; }
      })
      .hide();

      // Update position on window resize or scroll
      function resize() {
        var win = $(this);
        elem.css({
          height: win.height(),
          width: win.width()
        });
      }
      $(window).bind('resize'+MODALSELECTOR, resize);
      resize(); // Fire it initially too

      // Make sure we can't focus anything outside the tooltip
      $(document.body).bind('focusin'+MODALSELECTOR, stealFocus);

      // Apply keyboard "Escape key" close handler
      $(document).bind('keydown'+MODALSELECTOR, function(event) {
        if(current && current.options.show.modal.escape && event.keyCode === 27) {
          current.hide(event);
        }
      });

      // Apply click handler for blur option
      elem.bind('click'+MODALSELECTOR, function(event) {
        if(current && current.options.show.modal.blur) {
          current.hide(event);
        }
      });

      return self;
    },

    update: function(api) {
      // Update current API reference
      current = api;

      // Update focusable elements if enabled
      if(api.options.show.modal.stealfocus !== FALSE) {
        focusableElems = api.tooltip.find('*').filter(function() {
          return focusable(this);
        });
      }
      else { focusableElems = []; }
    },

    toggle: function(api, state, duration) {
      var docBody = $(document.body),
        tooltip = api.tooltip,
        options = api.options.show.modal,
        effect = options.effect,
        type = state ? 'show': 'hide',
        visible = elem.is(':visible'),
        visibleModals = $(MODALSELECTOR).filter(':visible:not(:animated)').not(tooltip),
        zindex;

      // Set active tooltip API reference
      self.update(api);

      // If the modal can steal the focus...
      // Blur the current item and focus anything in the modal we an
      if(state && options.stealfocus !== FALSE) {
        focusInputs( $(':focus') );
      }

      // Toggle backdrop cursor style on show
      elem.toggleClass('blurs', options.blur);

      // Set position and append to body on show
      if(state) {
        elem.css({ left: 0, top: 0 })
          .appendTo(document.body);
      }

      // Prevent modal from conflicting with show.solo, and don't hide backdrop is other modals are visible
      if((elem.is(':animated') && visible === state && prevState !== FALSE) || (!state && visibleModals.length)) {
        return self;
      }

      // Stop all animations
      elem.stop(TRUE, FALSE);

      // Use custom function if provided
      if($.isFunction(effect)) {
        effect.call(elem, state);
      }

      // If no effect type is supplied, use a simple toggle
      else if(effect === FALSE) {
        elem[ type ]();
      }

      // Use basic fade function
      else {
        elem.fadeTo( parseInt(duration, 10) || 90, state ? 1 : 0, function() {
          if(!state) { elem.hide(); }
        });
      }

      // Reset position and detach from body on hide
      if(!state) {
        elem.queue(function(next) {
          elem.css({ left: '', top: '' });
          if(!$(MODALSELECTOR).length) { elem.detach(); }
          next();
        });
      }

      // Cache the state
      prevState = state;

      // If the tooltip is destroyed, set reference to null
      if(current.destroyed) { current = NULL; }

      return self;
    }
  });

  self.init();
};
OVERLAY = new OVERLAY();

function Modal(api, options) {
  this.options = options;
  this._ns = '-modal';

  this.init( (this.qtip = api) );
}

$.extend(Modal.prototype, {
  init: function(qtip) {
    var tooltip = qtip.tooltip;

    // If modal is disabled... return
    if(!this.options.on) { return this; }

    // Set overlay reference
    qtip.elements.overlay = OVERLAY.elem;

    // Add unique attribute so we can grab modal tooltips easily via a SELECTOR, and set z-index
    tooltip.addClass(MODALCLASS).css('z-index', PLUGINS.modal.zindex + $(MODALSELECTOR).length);

    // Apply our show/hide/focus modal events
    qtip._bind(tooltip, ['tooltipshow', 'tooltiphide'], function(event, api, duration) {
      var oEvent = event.originalEvent;

      // Make sure mouseout doesn't trigger a hide when showing the modal and mousing onto backdrop
      if(event.target === tooltip[0]) {
        if(oEvent && event.type === 'tooltiphide' && /mouse(leave|enter)/.test(oEvent.type) && $(oEvent.relatedTarget).closest(overlay[0]).length) {
          try { event.preventDefault(); } catch(e) {}
        }
        else if(!oEvent || (oEvent && !oEvent.solo)) {
          this.toggle(event, event.type === 'tooltipshow', duration);
        }
      }
    }, this._ns, this);

    // Adjust modal z-index on tooltip focus
    qtip._bind(tooltip, 'tooltipfocus', function(event, api) {
      // If focus was cancelled before it reached us, don't do anything
      if(event.isDefaultPrevented() || event.target !== tooltip[0]) { return; }

      var qtips = $(MODALSELECTOR),

      // Keep the modal's lower than other, regular qtips
      newIndex = PLUGINS.modal.zindex + qtips.length,
      curIndex = parseInt(tooltip[0].style.zIndex, 10);

      // Set overlay z-index
      OVERLAY.elem[0].style.zIndex = newIndex - 1;

      // Reduce modal z-index's and keep them properly ordered
      qtips.each(function() {
        if(this.style.zIndex > curIndex) {
          this.style.zIndex -= 1;
        }
      });

      // Fire blur event for focused tooltip
      qtips.filter('.' + CLASS_FOCUS).qtip('blur', event.originalEvent);

      // Set the new z-index
      tooltip.addClass(CLASS_FOCUS)[0].style.zIndex = newIndex;

      // Set current
      OVERLAY.update(api);

      // Prevent default handling
      try { event.preventDefault(); } catch(e) {}
    }, this._ns, this);

    // Focus any other visible modals when this one hides
    qtip._bind(tooltip, 'tooltiphide', function(event) {
      if(event.target === tooltip[0]) {
        $(MODALSELECTOR).filter(':visible').not(tooltip).last().qtip('focus', event);
      }
    }, this._ns, this);
  },

  toggle: function(event, state, duration) {
    // Make sure default event hasn't been prevented
    if(event && event.isDefaultPrevented()) { return this; }

    // Toggle it
    OVERLAY.toggle(this.qtip, !!state, duration);
  },

  destroy: function() {
    // Remove modal class
    this.qtip.tooltip.removeClass(MODALCLASS);

    // Remove bound events
    this.qtip._unbind(this.qtip.tooltip, this._ns);

    // Delete element reference
    OVERLAY.toggle(this.qtip, FALSE);
    delete this.qtip.elements.overlay;
  }
});


MODAL = PLUGINS.modal = function(api) {
  return new Modal(api, api.options.show.modal);
};

// Setup sanitiztion rules
MODAL.sanitize = function(opts) {
  if(opts.show) {
    if(typeof opts.show.modal !== 'object') { opts.show.modal = { on: !!opts.show.modal }; }
    else if(typeof opts.show.modal.on === 'undefined') { opts.show.modal.on = TRUE; }
  }
};

// Base z-index for all modal tooltips (use qTip core z-index as a base)
MODAL.zindex = QTIP.zindex - 200;

// Plugin needs to be initialized on render
MODAL.initialize = 'render';

// Setup option set checks
CHECKS.modal = {
  '^show.modal.(on|blur)$': function() {
    // Initialise
    this.destroy();
    this.init();

    // Show the modal if not visible already and tooltip is visible
    this.qtip.elems.overlay.toggle(
      this.qtip.tooltip[0].offsetWidth > 0
    );
  }
};

// Extend original api defaults
$.extend(TRUE, QTIP.defaults, {
  show: {
    modal: {
      on: FALSE,
      effect: TRUE,
      blur: TRUE,
      stealfocus: TRUE,
      escape: TRUE
    }
  }
});
;PLUGINS.viewport = function(api, position, posOptions, targetWidth, targetHeight, elemWidth, elemHeight)
{
  var target = posOptions.target,
    tooltip = api.elements.tooltip,
    my = posOptions.my,
    at = posOptions.at,
    adjust = posOptions.adjust,
    method = adjust.method.split(' '),
    methodX = method[0],
    methodY = method[1] || method[0],
    viewport = posOptions.viewport,
    container = posOptions.container,
    cache = api.cache,
    tip = api.plugins.tip,
    adjusted = { left: 0, top: 0 },
    fixed, newMy, newClass;

  // If viewport is not a jQuery element, or it's the window/document or no adjustment method is used... return
  if(!viewport.jquery || target[0] === window || target[0] === document.body || adjust.method === 'none') {
    return adjusted;
  }

  // Cache our viewport details
  fixed = tooltip.css('position') === 'fixed';
  viewport = {
    elem: viewport,
    width: viewport[0] === window ? viewport.width() : viewport.outerWidth(FALSE),
    height: viewport[0] === window ? viewport.height() : viewport.outerHeight(FALSE),
    scrollleft: fixed ? 0 : viewport.scrollLeft(),
    scrolltop: fixed ? 0 : viewport.scrollTop(),
    offset: viewport.offset() || { left: 0, top: 0 }
  };
  container = {
    elem: container,
    scrollLeft: container.scrollLeft(),
    scrollTop: container.scrollTop(),
    offset: container.offset() || { left: 0, top: 0 }
  };

  // Generic calculation method
  function calculate(side, otherSide, type, adjust, side1, side2, lengthName, targetLength, elemLength) {
    var initialPos = position[side1],
      mySide = my[side], atSide = at[side],
      isShift = type === SHIFT,
      viewportScroll = -container.offset[side1] + viewport.offset[side1] + viewport['scroll'+side1],
      myLength = mySide === side1 ? elemLength : mySide === side2 ? -elemLength : -elemLength / 2,
      atLength = atSide === side1 ? targetLength : atSide === side2 ? -targetLength : -targetLength / 2,
      tipLength = tip && tip.size ? tip.size[lengthName] || 0 : 0,
      tipAdjust = tip && tip.corner && tip.corner.precedance === side && !isShift ? tipLength : 0,
      overflow1 = viewportScroll - initialPos + tipAdjust,
      overflow2 = initialPos + elemLength - viewport[lengthName] - viewportScroll + tipAdjust,
      offset = myLength - (my.precedance === side || mySide === my[otherSide] ? atLength : 0) - (atSide === CENTER ? targetLength / 2 : 0);

    // shift
    if(isShift) {
      tipAdjust = tip && tip.corner && tip.corner.precedance === otherSide ? tipLength : 0;
      offset = (mySide === side1 ? 1 : -1) * myLength - tipAdjust;

      // Adjust position but keep it within viewport dimensions
      position[side1] += overflow1 > 0 ? overflow1 : overflow2 > 0 ? -overflow2 : 0;
      position[side1] = Math.max(
        -container.offset[side1] + viewport.offset[side1] + (tipAdjust && tip.corner[side] === CENTER ? tip.offset : 0),
        initialPos - offset,
        Math.min(
          Math.max(-container.offset[side1] + viewport.offset[side1] + viewport[lengthName], initialPos + offset),
          position[side1]
        )
      );
    }

    // flip/flipinvert
    else {
      // Update adjustment amount depending on if using flipinvert or flip
      adjust *= (type === FLIPINVERT ? 2 : 0);

      // Check for overflow on the left/top
      if(overflow1 > 0 && (mySide !== side1 || overflow2 > 0)) {
        position[side1] -= offset + adjust;
        newMy.invert(side, side1);
      }

      // Check for overflow on the bottom/right
      else if(overflow2 > 0 && (mySide !== side2 || overflow1 > 0)  ) {
        position[side1] -= (mySide === CENTER ? -offset : offset) + adjust;
        newMy.invert(side, side2);
      }

      // Make sure we haven't made things worse with the adjustment and reset if so
      if(position[side1] < viewportScroll && -position[side1] > overflow2) {
        position[side1] = initialPos; newMy = my.clone();
      }
    }

    return position[side1] - initialPos;
  }

  // Set newMy if using flip or flipinvert methods
  if(methodX !== 'shift' || methodY !== 'shift') { newMy = my.clone(); }

  // Adjust position based onviewport and adjustment options
  adjusted = {
    left: methodX !== 'none' ? calculate( X, Y, methodX, adjust.x, LEFT, RIGHT, WIDTH, targetWidth, elemWidth ) : 0,
    top: methodY !== 'none' ? calculate( Y, X, methodY, adjust.y, TOP, BOTTOM, HEIGHT, targetHeight, elemHeight ) : 0
  };

  // Set tooltip position class if it's changed
  if(newMy && cache.lastClass !== (newClass = NAMESPACE + '-pos-' + newMy.abbrev())) {
    tooltip.removeClass(api.cache.lastClass).addClass( (api.cache.lastClass = newClass) );
  }

  return adjusted;
};;PLUGINS.polys = {
  // POLY area coordinate calculator
  //  Special thanks to Ed Cradock for helping out with this.
  //  Uses a binary search algorithm to find suitable coordinates.
  polygon: function(baseCoords, corner) {
    var result = {
      width: 0, height: 0,
      position: {
        top: 1e10, right: 0,
        bottom: 0, left: 1e10
      },
      adjustable: FALSE
    },
    i = 0, next,
    coords = [],
    compareX = 1, compareY = 1,
    realX = 0, realY = 0,
    newWidth, newHeight;

    // First pass, sanitize coords and determine outer edges
    i = baseCoords.length; while(i--) {
      next = [ parseInt(baseCoords[--i], 10), parseInt(baseCoords[i+1], 10) ];

      if(next[0] > result.position.right){ result.position.right = next[0]; }
      if(next[0] < result.position.left){ result.position.left = next[0]; }
      if(next[1] > result.position.bottom){ result.position.bottom = next[1]; }
      if(next[1] < result.position.top){ result.position.top = next[1]; }

      coords.push(next);
    }

    // Calculate height and width from outer edges
    newWidth = result.width = Math.abs(result.position.right - result.position.left);
    newHeight = result.height = Math.abs(result.position.bottom - result.position.top);

    // If it's the center corner...
    if(corner.abbrev() === 'c') {
      result.position = {
        left: result.position.left + (result.width / 2),
        top: result.position.top + (result.height / 2)
      };
    }
    else {
      // Second pass, use a binary search algorithm to locate most suitable coordinate
      while(newWidth > 0 && newHeight > 0 && compareX > 0 && compareY > 0)
      {
        newWidth = Math.floor(newWidth / 2);
        newHeight = Math.floor(newHeight / 2);

        if(corner.x === LEFT){ compareX = newWidth; }
        else if(corner.x === RIGHT){ compareX = result.width - newWidth; }
        else{ compareX += Math.floor(newWidth / 2); }

        if(corner.y === TOP){ compareY = newHeight; }
        else if(corner.y === BOTTOM){ compareY = result.height - newHeight; }
        else{ compareY += Math.floor(newHeight / 2); }

        i = coords.length; while(i--)
        {
          if(coords.length < 2){ break; }

          realX = coords[i][0] - result.position.left;
          realY = coords[i][1] - result.position.top;

          if((corner.x === LEFT && realX >= compareX) ||
          (corner.x === RIGHT && realX <= compareX) ||
          (corner.x === CENTER && (realX < compareX || realX > (result.width - compareX))) ||
          (corner.y === TOP && realY >= compareY) ||
          (corner.y === BOTTOM && realY <= compareY) ||
          (corner.y === CENTER && (realY < compareY || realY > (result.height - compareY)))) {
            coords.splice(i, 1);
          }
        }
      }
      result.position = { left: coords[0][0], top: coords[0][1] };
    }

    return result;
  },

  rect: function(ax, ay, bx, by, corner) {
    return {
      width: Math.abs(bx - ax),
      height: Math.abs(by - ay),
      position: {
        left: Math.min(ax, bx),
        top: Math.min(ay, by)
      }
    };
  },

  _angles: {
    tc: 3 / 2, tr: 7 / 4, tl: 5 / 4,
    bc: 1 / 2, br: 1 / 4, bl: 3 / 4,
    rc: 2, lc: 1, c: 0
  },
  ellipse: function(cx, cy, rx, ry, corner) {
    var c = PLUGINS.polys._angles[ corner.abbrev() ],
      rxc = rx * Math.cos( c * Math.PI ),
      rys = ry * Math.sin( c * Math.PI );

    return {
      width: (rx * 2) - Math.abs(rxc),
      height: (ry * 2) - Math.abs(rys),
      position: {
        left: cx + rxc,
        top: cy + rys
      },
      adjustable: FALSE
    };
  },
  circle: function(cx, cy, r, corner) {
    return PLUGINS.polys.ellipse(cx, cy, r, r, corner);
  }
};;PLUGINS.svg = function(api, svg, corner, adjustMethod)
{
  var doc = $(document),
    elem = svg[0],
    result = FALSE,
    name, box, position, dimensions;

  // Ascend the parentNode chain until we find an element with getBBox()
  while(!elem.getBBox) { elem = elem.parentNode; }
  if(!elem.getBBox || !elem.parentNode) { return FALSE; }

  // Determine which shape calculation to use
  switch(elem.nodeName) {
    case 'rect':
      position = PLUGINS.svg.toPixel(elem, elem.x.baseVal.value, elem.y.baseVal.value);
      dimensions = PLUGINS.svg.toPixel(elem,
        elem.x.baseVal.value + elem.width.baseVal.value,
        elem.y.baseVal.value + elem.height.baseVal.value
      );

      result = PLUGINS.polys.rect(
        position[0], position[1],
        dimensions[0], dimensions[1],
        corner
      );
    break;

    case 'ellipse':
    case 'circle':
      position = PLUGINS.svg.toPixel(elem,
        elem.cx.baseVal.value,
        elem.cy.baseVal.value
      );

      result = PLUGINS.polys.ellipse(
        position[0], position[1],
        (elem.rx || elem.r).baseVal.value,
        (elem.ry || elem.r).baseVal.value,
        corner
      );
    break;

    case 'line':
    case 'polygon':
    case 'polyline':
      points = elem.points || [
        { x: elem.x1.baseVal.value, y: elem.y1.baseVal.value },
        { x: elem.x2.baseVal.value, y: elem.y2.baseVal.value }
      ];

      for(result = [], i = -1, len = points.numberOfItems || points.length; ++i < len;) {
        next = points.getItem ? points.getItem(i) : points[i];
        result.push.apply(result, PLUGINS.svg.toPixel(elem, next.x, next.y));
      }

      result = PLUGINS.polys.polygon(result, corner);
    break;

    // Invalid shape
    default: return FALSE;
  }

  // Adjust by scroll offset
  result.position.left += doc.scrollLeft();
  result.position.top += doc.scrollTop();

  return result;
};

PLUGINS.svg.toPixel = function(elem, x, y) {
  var mtx = elem.getScreenCTM(),
    root = elem.farthestViewportElement || elem,
    result, point;

  // Create SVG point
  if(!root.createSVGPoint) { return FALSE; }
  point = root.createSVGPoint();

  point.x = x; point.y = y;
  result = point.matrixTransform(mtx);
  return [ result.x, result.y ];
};;PLUGINS.imagemap = function(api, area, corner, adjustMethod)
{
  if(!area.jquery) { area = $(area); }

  var shape = area.attr('shape').toLowerCase().replace('poly', 'polygon'),
    image = $('img[usemap="#'+area.parent('map').attr('name')+'"]'),
    coordsString = area.attr('coords'),
    coordsArray = coordsString.split(','),
    imageOffset, coords, i, next;

  // If we can't find the image using the map...
  if(!image.length) { return FALSE; }

  // Pass coordinates string if polygon
  if(shape === 'polygon') {
    result = PLUGINS.polys.polygon(coordsArray, corner);
  }

  // Otherwise parse the coordinates and pass them as arguments
  else if(PLUGINS.polys[shape]) {
    for(i = -1, len = coordsArray.length, coords = []; ++i < len;) {
      coords.push( parseInt(coordsArray[i], 10) );
    }

    result = PLUGINS.polys[shape].apply(
      this, coords.concat(corner)
    );
  }

  // If no shapre calculation method was found, return false
  else { return FALSE; }

  // Make sure we account for padding and borders on the image
  imageOffset = image.offset();
  imageOffset.left += Math.ceil((image.outerWidth(FALSE) - image.width()) / 2);
  imageOffset.top += Math.ceil((image.outerHeight(FALSE) - image.height()) / 2);

  // Add image position to offset coordinates
  result.position.left += imageOffset.left;
  result.position.top += imageOffset.top;

  return result;
};;var IE6,

/*
 * BGIFrame adaption (http://plugins.jquery.com/project/bgiframe)
 * Special thanks to Brandon Aaron
 */
BGIFRAME = '<iframe class="qtip-bgiframe" frameborder="0" tabindex="-1" src="javascript:\'\';" ' +
  ' style="display:block; position:absolute; z-index:-1; filter:alpha(opacity=0); ' +
    '-ms-filter:"progid:DXImageTransform.Microsoft.Alpha(Opacity=0)";"></iframe>';

function Ie6(api, qtip) {
  this._ns = 'ie6';
  this.init( (this.qtip = api) );
}

$.extend(Ie6.prototype, {
  _scroll : function() {
    var overlay = this.qtip.elements.overlay;
    overlay && (overlay[0].style.top = $(window).scrollTop() + 'px');
  },

  init: function(qtip) {
    var tooltip = qtip.tooltip,
      scroll;

    // Create the BGIFrame element if needed
    if($('select, object').length < 1) {
      this.bgiframe = qtip.elements.bgiframe = $(BGIFRAME).appendTo(tooltip);

      // Update BGIFrame on tooltip move
      qtip._bind(tooltip, 'tooltipmove', this.adjustBGIFrame, this._ns, this);
    }

    // redraw() container for width/height calculations
    this.redrawContainer = $('<div/>', { id: NAMESPACE+'-rcontainer' })
      .appendTo(document.body);

    // Fixup modal plugin if present too
    if( qtip.elements.overlay && qtip.elements.overlay.addClass('qtipmodal-ie6fix') ) {
      qtip._bind(window, ['scroll', 'resize'], this._scroll, this._ns, this);
      qtip._bind(tooltip, ['tooltipshow'], this._scroll, this._ns, this);
    }

    // Set dimensions
    this.redraw();
  },

  adjustBGIFrame: function() {
    var tooltip = this.qtip.tooltip,
      dimensions = {
        height: tooltip.outerHeight(FALSE),
        width: tooltip.outerWidth(FALSE)
      },
      plugin = this.qtip.plugins.tip,
      tip = this.qtip.elements.tip,
      tipAdjust, offset;

    // Adjust border offset
    offset = parseInt(tooltip.css('borderLeftWidth'), 10) || 0;
    offset = { left: -offset, top: -offset };

    // Adjust for tips plugin
    if(plugin && tip) {
      tipAdjust = (plugin.corner.precedance === 'x') ? [WIDTH, LEFT] : [HEIGHT, TOP];
      offset[ tipAdjust[1] ] -= tip[ tipAdjust[0] ]();
    }

    // Update bgiframe
    this.bgiframe.css(offset).css(dimensions);
  },

  // Max/min width simulator function
  redraw: function() {
    if(this.qtip.rendered < 1 || this.drawing) { return self; }

    var tooltip = this.qtip.tooltip,
      style = this.qtip.options.style,
      container = this.qtip.options.position.container,
      perc, width, max, min;

    // Set drawing flag
    this.qtip.drawing = 1;

    // If tooltip has a set height/width, just set it... like a boss!
    if(style.height) { tooltip.css(HEIGHT, style.height); }
    if(style.width) { tooltip.css(WIDTH, style.width); }

    // Simulate max/min width if not set width present...
    else {
      // Reset width and add fluid class
      tooltip.css(WIDTH, '').appendTo(this.redrawContainer);

      // Grab our tooltip width (add 1 if odd so we don't get wrapping problems.. huzzah!)
      width = tooltip.width();
      if(width % 2 < 1) { width += 1; }

      // Grab our max/min properties
      max = tooltip.css('maxWidth') || '';
      min = tooltip.css('minWidth') || '';

      // Parse into proper pixel values
      perc = (max + min).indexOf('%') > -1 ? container.width() / 100 : 0;
      max = ((max.indexOf('%') > -1 ? perc : 1) * parseInt(max, 10)) || width;
      min = ((min.indexOf('%') > -1 ? perc : 1) * parseInt(min, 10)) || 0;

      // Determine new dimension size based on max/min/current values
      width = max + min ? Math.min(Math.max(width, min), max) : width;

      // Set the newly calculated width and remvoe fluid class
      tooltip.css(WIDTH, Math.round(width)).appendTo(container);
    }

    // Set drawing flag
    this.drawing = 0;

    return self;
  },

  destroy: function() {
    // Remove iframe
    this.bgiframe && this.bgiframe.remove();

    // Remove bound events
    this.qtip._unbind([window, this.qtip.tooltip], this._ns);
  }
});

IE6 = PLUGINS.ie6 = function(api) {
  // Proceed only if the browser is IE6
  return BROWSER.ie === 6 ? new Ie6(api) : FALSE;
};

IE6.initialize = 'render';

CHECKS.ie6 = {
  '^content|style$': function() {
    this.redraw();
  }
};;}));
}( window, document ));




/*!
 * jQuery imagesLoaded plugin v2.1.1
 * http://github.com/desandro/imagesloaded
 *
 * MIT License. by Paul Irish et al.
 */

/*jshint curly: true, eqeqeq: true, noempty: true, strict: true, undef: true, browser: true */
/*global jQuery: false */

;(function($, undefined) {
'use strict';

// blank image data-uri bypasses webkit log warning (thx doug jones)
var BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

$.fn.imagesLoaded = function( callback ) {
  var $this = this,
    deferred = $.isFunction($.Deferred) ? $.Deferred() : 0,
    hasNotify = $.isFunction(deferred.notify),
    $images = $this.find('img').add( $this.filter('img') ),
    loaded = [],
    proper = [],
    broken = [];

  // Register deferred callbacks
  if ($.isPlainObject(callback)) {
    $.each(callback, function (key, value) {
      if (key === 'callback') {
        callback = value;
      } else if (deferred) {
        deferred[key](value);
      }
    });
  }

  function doneLoading() {
    var $proper = $(proper),
      $broken = $(broken);

    if ( deferred ) {
      if ( broken.length ) {
        deferred.reject( $images, $proper, $broken );
      } else {
        deferred.resolve( $images );
      }
    }

    if ( $.isFunction( callback ) ) {
      callback.call( $this, $images, $proper, $broken );
    }
  }

  function imgLoadedHandler( event ) {
    imgLoaded( event.target, event.type === 'error' );
  }

  function imgLoaded( img, isBroken ) {
    // don't proceed if BLANK image, or image is already loaded
    if ( img.src === BLANK || $.inArray( img, loaded ) !== -1 ) {
      return;
    }

    // store element in loaded images array
    loaded.push( img );

    // keep track of broken and properly loaded images
    if ( isBroken ) {
      broken.push( img );
    } else {
      proper.push( img );
    }

    // cache image and its state for future calls
    $.data( img, 'imagesLoaded', { isBroken: isBroken, src: img.src } );

    // trigger deferred progress method if present
    if ( hasNotify ) {
      deferred.notifyWith( $(img), [ isBroken, $images, $(proper), $(broken) ] );
    }

    // call doneLoading and clean listeners if all images are loaded
    if ( $images.length === loaded.length ) {
      setTimeout( doneLoading );
      $images.unbind( '.imagesLoaded', imgLoadedHandler );
    }
  }

  // if no images, trigger immediately
  if ( !$images.length ) {
    doneLoading();
  } else {
    $images.bind( 'load.imagesLoaded error.imagesLoaded', imgLoadedHandler )
    .each( function( i, el ) {
      var src = el.src;

      // find out if this image has been already checked for status
      // if it was, and src has not changed, call imgLoaded on it
      var cached = $.data( el, 'imagesLoaded' );
      if ( cached && cached.src === src ) {
        imgLoaded( el, cached.isBroken );
        return;
      }

      // if complete is true and browser supports natural sizes, try
      // to check for image status manually
      if ( el.complete && el.naturalWidth !== undefined ) {
        imgLoaded( el, el.naturalWidth === 0 || el.naturalHeight === 0 );
        return;
      }

      // cached images don't fire load sometimes, so we reset src, but only when
      // dealing with IE, or image is complete (loaded) and failed manual check
      // webkit hack from http://groups.google.com/group/jquery-dev/browse_thread/thread/eee6ab7b2da50e1f
      if ( el.readyState || el.complete ) {
        el.src = BLANK;
        el.src = src;
      }
    });
  }

  return deferred ? deferred.promise( $this ) : $this;
};

})(jQuery);