<!DOCTYPE html>
<html lang="en" ng-app="Wardrobe">
<head>
	<title>Admin | Wardrobe</title>
	<meta name="env" content="{{ App::environment() }}">
	<meta name="token" content="{{ Session::token() }}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" type="text/css" href="{{ asset('admin/style.css') }}">
</head>
<body>
<div id="header-region"></div>
<div id="js-alert"></div>
<div class="container-fluid">
	<div class="row-fluid">
		<div ng-view></div>
		<div id="main-region">HOME</div>
		<div>Angular seed app: v<span app-version></span></div>
	</div>
</div>
<script src="//ajax.googleapis.com/ajax/libs/jquery/1.9.1/jquery.min.js"></script>
</body>
</html>
